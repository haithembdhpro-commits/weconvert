#!/usr/bin/env bash
# WeConvert CRM — déploiement d'un environnement (staging ou production), à lancer sur ton ordinateur.
# Prérequis : Node 20+, `npx supabase login` et `npx wrangler login` faits une fois.
# Usage : bash scripts/deploy.sh staging|production
set -euo pipefail
ENV="${1:-}"
case "$ENV" in
 staging)    REF=rnnjgkojhoyooovyqvnl; PAGES=weconvert-crm-staging; KEY=sb_publishable_ly3iyv5oJ5VLVFwfuOpN6w_XoFEobVD ;;
 production) REF=loxdcfxxefigfchmrwzy; PAGES=weconvert-crm;         KEY="" ;;  # clé publiable déjà dans src/config.json
 *) echo "Usage : bash scripts/deploy.sh staging|production"; exit 1 ;;
esac
FRONT="${WECONVERT_FRONTEND_URL:-https://$PAGES.pages.dev}"
cd "$(dirname "$0")/.."
echo "== Vérifications locales"; npm ci; npm run check; npm test
echo "== Supabase ($ENV, $REF)"
npx supabase link --project-ref "$REF"
npx supabase migration list
read -r -p "Appliquer les migrations en attente listées ci-dessus sur $ENV ? (oui/non) " ok; [ "$ok" = "oui" ] || exit 1
npx supabase db push
# Le cron ZR d'une ancienne migration pointe vers la production : on corrige l'URL pour cet environnement.
[ "$ENV" = staging ] && echo "!! Staging : demande à Claude de corriger le secret Vault weconvert_zr_project_url (ou SQL editor : select vault.update_secret((select id from vault.secrets where name='weconvert_zr_project_url'),'https://$REF.supabase.co');)"
npx supabase secrets set --project-ref "$REF" WECONVERT_FRONTEND_URL="$FRONT"
echo "== Frontend (Cloudflare : $PAGES)"
if [ -n "$KEY" ]; then WECONVERT_SUPABASE_URL="https://$REF.supabase.co" WECONVERT_SUPABASE_KEY="$KEY" npm run build; else npm run build; fi
npx wrangler pages project create "$PAGES" --production-branch main 2>/dev/null || true
npx wrangler pages deploy dist --project-name "$PAGES" --branch main
echo "== Edge Functions (après le frontend : le retour OAuth vise $FRONT/#oauth/...)"
for f in weconvert-woocommerce weconvert-shopify weconvert-youcan weconvert-zr; do
 npx supabase functions deploy "$f" --project-ref "$REF" --no-verify-jwt
done
echo "== Fini. À faire dans Supabase → Authentication → URL Configuration : Site URL = $FRONT (et l'ajouter aux Redirect URLs)."
