#!/usr/bin/env bash
# Offline SQL harness: throwaway local Postgres 16 + Supabase stub + migrations + tests/*.sql.
# Never contacts a remote Supabase project. Usage: bash tests/harness/run.sh
# Env overrides: PGBIN, PGDATA_DIR, PGPORT_LOCAL, TEST_DB
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
# Outside any 0700 tree: the postgres OS user must be able to reach it.
PGDATA_DIR="${PGDATA_DIR:-/var/tmp/weconvert-crm-pg}"
PORT="${PGPORT_LOCAL:-54329}"
DB="${TEST_DB:-weconvert_test}"
OSUSER=postgres
LOGDIR="$PGDATA_DIR/harness-logs"

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u "$OSUSER" -- "$@"; else "$@"; fi; }
PSQL=(psql -X -q -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1)

# 1. Cluster (create once, start if stopped)
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$PGDATA_DIR"; chown "$OSUSER" "$PGDATA_DIR"
fi
if [ ! -s "$PGDATA_DIR/data/PG_VERSION" ]; then
  as_pg "$PGBIN/initdb" -D "$PGDATA_DIR/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null || exit 2
  cat >>"$PGDATA_DIR/data/postgresql.conf" <<EOF
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$PGDATA_DIR'
fsync = off
synchronous_commit = off
full_page_writes = off
timezone = 'UTC'
EOF
fi
if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" -l "$PGDATA_DIR/server.log" -w start >/dev/null || { tail -20 "$PGDATA_DIR/server.log"; exit 2; }
fi
mkdir -p "$LOGDIR"

# 2. Fresh database + stub + migrations
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null || exit 2
if ! "${PSQL[@]}" -d "$DB" -f "$ROOT/tests/harness/supabase-stub.sql" >"$LOGDIR/stub.log" 2>&1; then
  echo "STUB FAILED"; cat "$LOGDIR/stub.log"; exit 2; fi
n=0
for m in "$ROOT"/supabase/migrations/*.sql; do
  if ! "${PSQL[@]}" -d "$DB" -1 -f "$m" >"$LOGDIR/migration.log" 2>&1; then
    echo "MIGRATION FAILED: $(basename "$m")"; grep -E "ERROR|LINE|DETAIL|HINT|CONTEXT" "$LOGDIR/migration.log" | head -20; exit 3; fi
  n=$((n+1))
done
echo "Migrations applied: $n"
# Template so each test group starts from the same freshly-migrated state
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_tpl with (force)" -c "create database ${DB}_tpl template $DB" >/dev/null || exit 2

# 3. Tests. Groups share one transaction (files that "continue" a previous one).
#    Files containing their own top-level BEGIN/ROLLBACK are run as-is.
GROUPS_LIST=("database.sql edge-cases.sql realtime.sql")
grouped=" database.sql edge-cases.sql realtime.sql "
for f in "$ROOT"/tests/*.sql; do b="$(basename "$f")"; case "$grouped" in *" $b "*) ;; *) GROUPS_LIST+=("$b");; esac; done

pass=0; fail=0; skip=0
run_group() {
  local files=($1) tdb="${DB}_run" input="$LOGDIR/input.sql" out="$LOGDIR/group-${files[0]%.sql}.log" selfwrap=0
  "${PSQL[@]}" -d postgres -c "drop database if exists $tdb with (force)" -c "create database $tdb template ${DB}_tpl" >/dev/null || exit 2
  [ ${#files[@]} -eq 1 ] && grep -qiE '^[[:space:]]*begin;' "$ROOT/tests/${files[0]}" && selfwrap=1
  { [ $selfwrap = 1 ] || echo "begin;"
    for f in "${files[@]}"; do echo "\\echo @@FILE $f"; echo "\\i $ROOT/tests/$f"; done
    [ $selfwrap = 1 ] || echo "rollback;"; } >"$input"
  "${PSQL[@]}" -d "$tdb" -f "$input" >"$out" 2>&1; local rc=$?
  local failed=""; [ $rc -ne 0 ] && failed="$(grep -o '^@@FILE .*' "$out" | tail -1 | cut -d' ' -f2)"
  local after=0
  for f in "${files[@]}"; do
    if [ $rc -eq 0 ]; then echo "PASS  $f"; pass=$((pass+1))
    elif [ "$f" = "$failed" ]; then echo "FAIL  $f"; sed -n '/^@@FILE '"$f"'/,$p' "$out" | grep -E "ERROR|DETAIL|HINT|CONTEXT|LINE|psql:" | head -8 | sed 's/^/      /'; fail=$((fail+1)); after=1
    elif [ $after = 1 ]; then echo "SKIP  $f (depends on failed $failed)"; skip=$((skip+1))
    else echo "PASS  $f"; pass=$((pass+1)); fi
  done
}
for g in "${GROUPS_LIST[@]}"; do run_group "$g"; done
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_run with (force)" >/dev/null
echo "Result: $pass pass, $fail fail, $skip skipped. Logs: $LOGDIR"
echo "Connect: psql -h 127.0.0.1 -p $PORT -U postgres -d $DB"
echo "Stop:    runuser -u $OSUSER -- $PGBIN/pg_ctl -D $PGDATA_DIR/data stop"
[ $fail -eq 0 ] && [ $skip -eq 0 ]
