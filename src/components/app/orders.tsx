import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, ChevronDown, ChevronRight, Clock, Pencil, Plus, Search, Users, X } from "lucide-react"
import { CHANNELS, PENDING, STATUS, initialsOf, localInputToISO, orderAmount } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, FormError, FormField, Loading, Notice } from "@/components/app/page"
import { StatusBadge, ToneBadge } from "@/components/app/tone"
import { rpc, safeError, wooLabel } from "@/lib/api"
import { ZR_STATES } from "@/lib/edge"
import { f, money, orderCode, shortDate, time } from "@/lib/format"
import { searchProducts, useOrderDetail } from "@/lib/queries"
import { useSession } from "@/lib/session"
import type { Order, OrderEvent, Product } from "@/lib/types"

/* ------------------------------------------------------------------ table */

/** Optional columns of the orders table (the order number, client, amount and status are always shown). */
export const ORDER_COLUMNS: [string, string][] = [
  ["product", "Produit"],
  ["wilaya", "Adresse"],
  ["agent", "Agent"],
  ["delivery", "Livraison"],
  ["source", "Source"],
  ["date", "Date"],
]
const ALL_COLUMNS = new Set(ORDER_COLUMNS.map(([k]) => k))
const PROVIDERS: Record<string, string> = { shopify: "Shopify", youcan: "YouCan" }

function sourceLabel(o: Order) {
  if (o.woo_snapshot) return "WooCommerce"
  if (o.source_provider) return PROVIDERS[o.source_provider] || o.source_provider
  return CHANNELS[o.channel] || o.channel
}

/** Carrier state of the CRM parcel. A carrier "Livré" is not proof of cash collection. */
export function DeliveryBadge({ o }: { o: Order }) {
  if (!o.shipment) return <span className="text-sm text-muted-foreground">—</span>
  const [label, tone] = ZR_STATES[o.shipment.state] || [o.shipment.state, "neutral"]
  return (
    <span className="grid gap-0.5">
      <ToneBadge tone={tone}>{label}</ToneBadge>
      {o.shipment.tracking && <span className="num text-xs text-muted-foreground">{o.shipment.tracking}</span>}
    </span>
  )
}

const CALLS = [1, 2, 3]

/**
 * Confirmoo-style status: the badge opens the transitions allowed for this order.
 * Server rules still decide (RPC crm_command); the menu only hides moves that would be refused.
 */
export function StatusMenu({ o }: { o: Order }) {
  const s = useSession()
  const ui = useOrderUI()
  const pending = PENDING.includes(o.status)
  const shipped = !!o.shipment && o.shipment.state !== "cancelled"
  const canReopen = s.manager && !pending && !shipped
  const canCancel = s.manager && o.status === "confirmed" && !shipped
  if (!pending && !canReopen && !canCancel) return <StatusBadge status={o.status} />
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={"Changer le statut de " + orderCode(o) + " (actuel : " + (STATUS[o.status]?.[0] || o.status) + ")"}
          className="-mx-1.5 inline-flex min-h-8 coarse:min-h-11 items-center gap-1 rounded-md px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatusBadge status={o.status} />
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" onClick={(e) => e.stopPropagation()}>
        {pending ? (
          <>
            <DropdownMenuLabel>Appel sans réponse</DropdownMenuLabel>
            {CALLS.map((n) => (
              <DropdownMenuItem key={n} className="min-h-8 coarse:min-h-10" disabled={n <= o.attempts} onSelect={() => ui.noAnswer(o, n)}>
                {n === 3 ? "Appel 3+" : "Appel " + n}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.setStatus(o, "confirmed")}>
              Confirmée
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.callback(o)}>
              Reportée (rappel daté)…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" disabled={o.status === "check"} onSelect={() => ui.setStatus(o, "check")}>
              À vérifier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.setStatus(o, "fake")}>
              Faux numéro…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.setStatus(o, "duplicate")}>
              Doublon…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" variant="destructive" onSelect={() => ui.setStatus(o, "cancelled")}>
              Annulée…
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {canReopen && (
              <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.setStatus(o, "new")}>
                Rouvrir (Nouvelle)…
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem className="min-h-8 coarse:min-h-10" variant="destructive" onSelect={() => ui.setStatus(o, "cancelled")}>
                Annulée…
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function OrdersTable({
  orders,
  compact = false,
  selected,
  onToggle,
  onToggleAll,
  columns = ALL_COLUMNS,
}: {
  orders: Order[]
  compact?: boolean
  selected?: Set<string>
  onToggle?: (id: string, on: boolean) => void
  onToggleAll?: (on: boolean) => void
  columns?: Set<string>
}) {
  const s = useSession()
  const ui = useOrderUI()
  const selectable = !compact && s.manager && !!selected
  const allOn = selectable && orders.length > 0 && orders.every((o) => selected!.has(o.id))
  const show = (k: string) => columns.has(k) && !(compact && (k === "agent" || k === "source" || k === "product"))
  if (!orders.length) return <EmptyState title="Aucune commande" description="Ajoutez une commande ou adaptez votre recherche." />
  return (
    <>
    {/* Phones: one card per order, the agent's main format. */}
    <ul className="divide-y md:hidden">
      {orders.map((o) => (
        <li key={o.id} className="flex items-start gap-3 px-4 py-3">
          {selectable && (
            <Checkbox checked={selected!.has(o.id)} onCheckedChange={(v) => onToggle?.(o.id, !!v)} aria-label={"Sélectionner " + orderCode(o)} className="mt-1 size-5" />
          )}
          <button type="button" onClick={() => ui.openOrder(o.id)} className="grid min-w-0 flex-1 gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="num text-sm font-semibold text-primary">#{orderCode(o)}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{o.customer_name}</span>
              <span className="num shrink-0 font-semibold">{money(o.total)}</span>
            </span>
            <span className="num truncate text-xs text-muted-foreground">
              {o.phone} · {o.wilaya} · {shortDate(o.created_at)}
            </span>
            {o.callback_at && <span className="num text-xs text-warning">Rappel {time(o.callback_at)}</span>}
            {o.shipment && <span className="text-xs text-muted-foreground">Livraison : {(ZR_STATES[o.shipment.state] || [o.shipment.state])[0]}</span>}
            {(o.woo_attention || o.status_origin === "woo_legacy") && (
              <span className="text-xs text-muted-foreground">{o.woo_attention ? "WooCommerce à vérifier" : "Statut Woo non vérifié"}</span>
            )}
          </button>
          <div className="shrink-0">
            <StatusMenu o={o} />
          </div>
        </li>
      ))}
    </ul>
    <div role="region" aria-label="Commandes, défilement horizontal si nécessaire" tabIndex={0} className="hidden overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring md:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {selectable && (
              <TableHead className="w-11">
                <Checkbox checked={allOn} onCheckedChange={(v) => onToggleAll?.(!!v)} aria-label="Sélectionner la page" className="size-5" />
              </TableHead>
            )}
            <TableHead>N° commande</TableHead>
            <TableHead>Client</TableHead>
            {show("product") && <TableHead>Produit</TableHead>}
            {show("wilaya") && <TableHead>Adresse</TableHead>}
            <TableHead className="text-right">Montant COD</TableHead>
            {show("agent") && <TableHead>Agent</TableHead>}
            <TableHead>Statut</TableHead>
            {show("delivery") && <TableHead>Livraison</TableHead>}
            {show("source") && <TableHead>Source</TableHead>}
            {show("date") && <TableHead>Date</TableHead>}
            <TableHead>
              <span className="sr-only">Ouvrir</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id} className="cursor-pointer" onClick={() => ui.openOrder(o.id)}>
              {selectable && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected!.has(o.id)} onCheckedChange={(v) => onToggle?.(o.id, !!v)} aria-label={"Sélectionner " + orderCode(o)} className="size-5" />
                </TableCell>
              )}
              <TableCell>
                <button
                  type="button"
                  className="num font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(e) => {
                    e.stopPropagation()
                    ui.openOrder(o.id)
                  }}
                >
                  #{orderCode(o)}
                </button>
                {!show("source") && <span className="block text-xs text-muted-foreground">{CHANNELS[o.channel]}</span>}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {initialsOf(o.customer_name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{o.customer_name}</span>
                    <span className="num block text-xs text-muted-foreground">{o.phone}</span>
                  </span>
                </div>
              </TableCell>
              {show("product") && (
                <TableCell>
                  <span className="block">{o.items?.[0]?.product_name || "—"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {(o.items || []).length > 1 ? "+" + ((o.items || []).length - 1) + " autre(s) produit(s)" : f(o.items?.[0]?.quantity) + " article(s)"}
                  </span>
                </TableCell>
              )}
              {show("wilaya") && (
                <TableCell>
                  <span className="block">{o.wilaya}</span>
                  <span className="block text-xs text-muted-foreground">{o.commune || "Commune à compléter"}</span>
                </TableCell>
              )}
              <TableCell className="num text-right font-semibold">{money(o.total)}</TableCell>
              {show("agent") && <TableCell>{s.memberName(o.assigned_to)}</TableCell>}
              <TableCell>
                <StatusMenu o={o} />
                {o.status_origin === "woo_legacy" && <span className="mt-1 block text-xs text-muted-foreground">Statut Woo non vérifié</span>}
                {o.woo_attention && <span className="mt-1 block text-xs text-muted-foreground">WooCommerce à vérifier</span>}
                {o.callback_at && <span className="num mt-1 block text-xs text-muted-foreground">{time(o.callback_at)}</span>}
              </TableCell>
              {show("delivery") && (
                <TableCell>
                  <DeliveryBadge o={o} />
                </TableCell>
              )}
              {show("source") && (
                <TableCell>
                  <span className="block">{sourceLabel(o)}</span>
                  {sourceLabel(o) !== CHANNELS[o.channel] && <span className="block text-xs text-muted-foreground">{CHANNELS[o.channel]}</span>}
                </TableCell>
              )}
              {show("date") && <TableCell className="num text-muted-foreground">{shortDate(o.created_at)}</TableCell>}
              <TableCell>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </>
  )
}

/* -------------------------------------------------------- dialogs context */

type Ui = {
  openOrder: (id: string) => void
  newOrder: () => void
  editOrder: (id: string) => void
  assign: (ids: { id: string; version: number }[], current?: string | null) => void
  callback: (o: Order) => void
  setStatus: (o: Order, status: string) => Promise<void>
  noAnswer: (o: Order, attempt?: number) => Promise<void>
}
const UiCtx = createContext<Ui | null>(null)
export const useOrderUI = () => {
  const c = useContext(UiCtx)
  if (!c) throw Error("OrderUIProvider missing")
  return c
}

const REASON_STATUSES = ["cancelled", "duplicate", "fake", "new"]

export function OrderUIProvider({ children, onAssigned }: { children: ReactNode; onAssigned?: (ids: string[]) => void }) {
  const s = useSession()
  const qc = useQueryClient()
  const [detail, setDetail] = useState<string | null>(null)
  const [form, setForm] = useState<{ id: string | null } | null>(null)
  const [reason, setReason] = useState<{ order: Order; status: string } | null>(null)
  const [callbackFor, setCallbackFor] = useState<Order | null>(null)
  const [assignFor, setAssignFor] = useState<{ ids: { id: string; version: number }[]; current?: string | null } | null>(null)
  const busy = useRef(false)

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["store", s.store] }), [qc, s.store])

  const mutate = useCallback(
    async (action: string, payload: Record<string, unknown>) => {
      await s.command(action, payload)
      toast.success("Modification enregistrée.")
      await refresh()
    },
    [s, refresh],
  )

  const ui = useMemo<Ui>(
    () => ({
      openOrder: (id) => setDetail(id),
      newOrder: () => setForm({ id: null }),
      editOrder: (id) => setForm({ id }),
      assign: (ids, current) => setAssignFor({ ids, current }),
      callback: (o) => setCallbackFor(o),
      setStatus: async (o, status) => {
        if (REASON_STATUSES.includes(status)) return setReason({ order: o, status })
        if (busy.current) return
        busy.current = true
        try {
          await mutate("order.status", { id: o.id, version: o.version, status })
        } catch (e) {
          toast.error(safeError(e))
        } finally {
          busy.current = false
        }
      },
      noAnswer: async (o, attempt) => {
        if (busy.current) return
        busy.current = true
        try {
          await mutate("order.call", attempt ? { id: o.id, version: o.version, attempt } : { id: o.id, version: o.version })
        } catch (e) {
          toast.error(safeError(e))
        } finally {
          busy.current = false
        }
      },
    }),
    [mutate],
  )

  return (
    <UiCtx.Provider value={ui}>
      {children}
      <OrderDetailDialog id={detail} onClose={() => setDetail(null)} />
      {form && <OrderFormDialog id={form.id} onClose={() => setForm(null)} />}
      {reason && (
        <ReasonDialog
          title={STATUS[reason.status][0]}
          onClose={() => setReason(null)}
          onSubmit={(text) => mutate("order.status", { id: reason.order.id, version: reason.order.version, status: reason.status, reason: text }).then(() => setReason(null))}
        />
      )}
      {callbackFor && (
        <CallbackDialog
          onClose={() => setCallbackFor(null)}
          onSubmit={(at, note) => mutate("order.callback", { id: callbackFor.id, version: callbackFor.version, callback_at: localInputToISO(at), note }).then(() => setCallbackFor(null))}
        />
      )}
      {assignFor && (
        <AssignDialog
          count={assignFor.ids.length}
          current={assignFor.current ?? ""}
          onClose={() => setAssignFor(null)}
          onSubmit={async (agent) => {
            let done = 0
            const failures: unknown[] = []
            const ok: string[] = []
            for (const o of assignFor.ids) {
              try {
                await s.command("order.assign", { id: o.id, version: o.version, assigned_to: agent || null })
                ok.push(o.id)
                done++
              } catch (err) {
                failures.push(err)
              }
            }
            setAssignFor(null)
            onAssigned?.(ok)
            await refresh()
            toast.success(done + " commande(s) affectée(s).")
            if (failures.length) toast.error(failures.length + " échec(s). " + safeError(failures[0]))
          }}
        />
      )}
    </UiCtx.Provider>
  )
}

/* ------------------------------------------------------------ small forms */

function useSubmit() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(safeError(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run }
}

function ReasonDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const { error, busy, run } = useSubmit()
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Le motif est conservé dans l’historique de la commande.</DialogDescription>
        </DialogHeader>
        <form
          id="reason-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const reason = String(new FormData(e.currentTarget).get("reason") || "")
            run(() => onSubmit(reason))
          }}
        >
          <FormField label="Motif" htmlFor="reason" required>
            <Textarea id="reason" name="reason" required minLength={2} maxLength={2000} rows={3} />
          </FormField>
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form="reason-form" disabled={busy}>
            Enregistrer le statut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CallbackDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (at: string, note: string) => Promise<unknown> }) {
  const { error, busy, run } = useSubmit()
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Planifier un rappel</DialogTitle>
          <DialogDescription>Heure de votre appareil : {Intl.DateTimeFormat().resolvedOptions().timeZone}.</DialogDescription>
        </DialogHeader>
        <form
          id="callback-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const d = new FormData(e.currentTarget)
            run(() => onSubmit(String(d.get("callback_at")), String(d.get("note") || "")))
          }}
        >
          <FormField label="Date et heure du rappel" htmlFor="cb-at" required>
            <Input id="cb-at" name="callback_at" type="datetime-local" required />
          </FormField>
          <FormField label="Note" htmlFor="cb-note">
            <Input id="cb-note" name="note" maxLength={2000} />
          </FormField>
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form="callback-form" disabled={busy}>
            Planifier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({ count, current, onClose, onSubmit }: { count: number; current: string; onClose: () => void; onSubmit: (agent: string) => Promise<unknown> }) {
  const s = useSession()
  const { error, busy, run } = useSubmit()
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{count > 1 ? `Affecter ${count} commandes` : "Affecter la commande"}</DialogTitle>
          <DialogDescription>Un agent ne voit que les commandes qui lui sont affectées.</DialogDescription>
        </DialogHeader>
        <form
          id="assign-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => onSubmit(String(new FormData(e.currentTarget).get("assigned_to") || "")))
          }}
        >
          <FormField label="Agent" htmlFor="assign-agent">
            <NativeSelect id="assign-agent" name="assigned_to" defaultValue={current}>
              <NativeSelectOption value="">Non attribué</NativeSelectOption>
              {s.members.filter((m) => m.active).map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form="assign-form" disabled={busy}>
            Affecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------- order detail */

export function ItemsSummary({ o }: { o: Order }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableHead>Produit</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            <TableHead className="text-right">Prix unitaire</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(o.items || []).map((i) => (
            <TableRow key={i.product_id}>
              <TableCell>
                <b className="font-medium">{i.product_name}</b>
                <span className="block text-xs text-muted-foreground">{i.sku}</span>
              </TableCell>
              <TableCell className="num text-right">{f(i.quantity)}</TableCell>
              <TableCell className="num text-right">{money(i.unit_price)}</TableCell>
              <TableCell className="num text-right">{money(Number(i.quantity) * Number(i.unit_price))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function OrderActions({ o }: { o: Order }) {
  const s = useSession()
  const ui = useOrderUI()
  const pending = PENDING.includes(o.status)
  if (!pending && !s.manager) return null
  return (
    <div className="flex flex-wrap gap-2">
      {pending ? (
        <>
          <Button onClick={() => ui.setStatus(o, "confirmed")}>
            <Check />
            Confirmer
          </Button>
          <Button variant="outline" onClick={() => ui.callback(o)}>
            <Clock />
            Planifier un rappel
          </Button>
          <Button variant="outline" onClick={() => ui.noAnswer(o)}>
            Sans réponse
          </Button>
          <Button variant="outline" onClick={() => ui.editOrder(o.id)}>
            <Pencil />
            Modifier
          </Button>
          <Button variant="outline" onClick={() => ui.setStatus(o, "check")} disabled={o.status === "check"}>
            À vérifier
          </Button>
          <Button variant="outline" onClick={() => ui.setStatus(o, "fake")}>
            Faux numéro
          </Button>
          <Button variant="outline" onClick={() => ui.setStatus(o, "duplicate")}>
            Doublon
          </Button>
          <Button variant="destructive" onClick={() => ui.setStatus(o, "cancelled")}>
            Annuler
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={() => ui.setStatus(o, "new")}>
            Rouvrir la commande
          </Button>
          {o.status === "confirmed" && (
            <Button variant="destructive" onClick={() => ui.setStatus(o, "cancelled")}>
              Annuler
            </Button>
          )}
        </>
      )}
    </div>
  )
}

export function NoteForm({ o }: { o: Order }) {
  const s = useSession()
  const qc = useQueryClient()
  const { error, busy, run } = useSubmit()
  const [note, setNote] = useState("")
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          await s.command("order.note", { id: o.id, version: o.version, note: note.trim() })
          setNote("")
          toast.success("Note enregistrée.")
          await qc.invalidateQueries({ queryKey: ["store", s.store] })
        })
      }}
    >
      <FormField label="Compte rendu ou note interne" htmlFor={"note-" + o.id}>
        <Textarea
          id={"note-" + o.id}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          maxLength={2000}
          rows={3}
          placeholder="Disponibilité, repère, objection, demande du client…"
        />
      </FormField>
      <FormError message={error} />
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !note.trim()}>
          Enregistrer la note
        </Button>
      </div>
    </form>
  )
}

function eventText(e: OrderEvent, memberName: (id: string) => string) {
  const d = e.data || {}
  const woo: Record<string, string> = {
    "woo.imported": "Commande importée de WooCommerce #" + d.number,
    "woo.updated": "Commande mise à jour depuis WooCommerce #" + d.number,
    "woo.attention": "Modification WooCommerce à vérifier : " + wooLabel(d.reason),
    "woo.reviewed": "Modification WooCommerce vérifiée ; fiche CRM conservée.",
  }
  if (e.kind.startsWith("woo.")) return woo[e.kind] || e.kind
  const texts: Record<string, string> = {
    "order.created": "Commande créée · " + (CHANNELS[d.channel] || ""),
    "order.edited": "Coordonnées ou contenu de la commande modifiés.",
    "order.status": (STATUS[d.from]?.[0] || d.from) + " → " + (STATUS[d.to]?.[0] || d.to) + (d.reason ? " · " + d.reason : ""),
    "order.call": "Appel " + d.attempt + " : sans réponse.",
    "order.callback": "Rappel prévu le " + time(d.callback_at) + (d.note ? " · " + d.note : ""),
    "order.note": d.note,
    "order.assigned": "Affectation : " + memberName(d.to),
    "source.reviewed": "Modification de la boutique source vérifiée ; fiche CRM conservée.",
    "stock.shipped": "Colis remis à ZR : stock physique et réservation déduits.",
    "stock.returned": "Colis retourné : quantités remises en stock.",
    "stock.restored": "Colis annulé chez ZR : stock et réservation rétablis.",
  }
  return texts[e.kind] || e.kind
}

export function OrderHistory({ o }: { o: Order }) {
  const s = useSession()
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Historique · 100 derniers événements</h3>
      <ol className="grid gap-3 border-l pl-4">
        {(o.events || []).map((e, i) => (
          <li key={e.id ?? i} className="relative">
            <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" />
            <p className="num text-xs text-muted-foreground">
              {time(e.created_at)} · {e.actor_name}
            </p>
            <p className="text-sm">{eventText(e, s.memberName)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Compare({ s }: { s: Record<string, any> }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Client</dt>
      <dd>
        {s.customer_name || "—"} · {s.phone || "—"}
      </dd>
      <dt className="text-muted-foreground">Adresse</dt>
      <dd>{[s.wilaya, s.commune, s.address].filter(Boolean).join(" · ") || "—"}</dd>
      <dt className="text-muted-foreground">Montant source</dt>
      <dd className="num">{s.total !== undefined ? money(s.total) : "—"}</dd>
      {s.items && (
        <>
          <dt className="text-muted-foreground">Articles</dt>
          <dd>{(s.items || []).map((x: any) => x.quantity + " × " + x.name).join(" ; ") || "—"}</dd>
        </>
      )}
    </dl>
  )
}

export function SourcePanels({ o }: { o: Order }) {
  const s = useSession()
  const qc = useQueryClient()
  const { error, busy, run } = useSubmit()
  const ack = (fn: string) =>
    run(async () => {
      await rpc(fn, { p_order: o.id, p_version: o.version })
      toast.success("Vérification enregistrée.")
      await qc.invalidateQueries({ queryKey: ["store", s.store] })
    })
  const panels: ReactNode[] = []
  if (o.woo_snapshot) {
    const w = o.woo_snapshot
    panels.push(
      <section key="woo" className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b>WooCommerce #{o.woo_number}</b>
          <ToneBadge tone={o.woo_attention ? "warning" : "info"}>{o.woo_attention ? "Modification à vérifier" : "Source synchronisée"}</ToneBadge>
        </div>
        <p className="mt-2 text-sm">
          Statut WooCommerce : {o.woo_status} · {time(w.modified_at)} · la confirmation COD est gérée séparément.
        </p>
        {o.status_origin === "woo_legacy" && (
          <Notice tone="warning" className="mt-3">
            Ancien statut CRM déduit de WooCommerce : décision COD non vérifiée. Rapprochez cette commande avec le système de confirmation d’origine.
          </Notice>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <ToneBadge tone={o.woo_purchase_event_id ? "success" : "warning"}>{o.woo_purchase_event_id ? "Purchase CAPI marqué envoyé" : "Suivi Purchase non prouvé"}</ToneBadge>
          <span className="text-xs text-muted-foreground">
            {o.woo_purchase_event_id ? "Marqueur enregistré par la Suite ; déduplication Meta non vérifiée." : "Cette fiche reste utilisable pour la confirmation, mais ne prouve aucun envoi Meta."}
          </span>
        </p>
        {o.woo_attention && (
          <>
            <p className="mt-3 text-sm">La fiche CRM a été conservée. Comparez les dernières informations reçues avant de poursuivre.</p>
            <Compare s={w} />
            {w.skip && <p className="mt-2 text-sm font-semibold">{wooLabel(w.skip)}</p>}
            <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => ack("crm_woo_ack")}>
              Marquer comme vérifié
            </Button>
          </>
        )}
        {w.note && (
          <p className="mt-3 text-sm">
            <b>Note client :</b> {w.note}
          </p>
        )}
      </section>,
    )
  }
  if (o.source_provider === "shopify" || o.source_provider === "youcan") {
    const name = o.source_provider === "shopify" ? "Shopify" : "YouCan"
    const src = o.source_snapshot || {}
    panels.push(
      <section key="src" className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b>
            {name} #{src.number || o.source_external_id}
          </b>
          <ToneBadge tone={o.source_attention ? "warning" : "info"}>{o.source_attention ? "Modification à vérifier" : "Source synchronisée"}</ToneBadge>
        </div>
        <p className="mt-2 text-sm">
          État {name} : {o.source_status || "Inconnu"} · {time(src.updated_at)}. La confirmation COD et le statut de livraison ZR sont indépendants.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Tracking publicitaire {name} : aucune preuve WeConvert associée à cette commande.</p>
        {o.source_attention && (
          <>
            <p className="mt-3 text-sm">La fiche CRM a été conservée. Vérifiez la nouvelle version dans {name} avant de corriger la commande.</p>
            <Compare s={{ ...src, items: undefined }} />
            <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => ack("crm_source_ack")}>
              Marquer comme vérifié
            </Button>
          </>
        )}
      </section>,
    )
  }
  if (!panels.length) return null
  return (
    <div className="grid gap-3">
      {panels}
      <FormError message={error} />
    </div>
  )
}

function OrderDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useSession()
  const ui = useOrderUI()
  const q = useOrderDetail(id)
  const o = q.data
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{o ? "Commande #" + orderCode(o) : "Commande"}</DialogTitle>
          <DialogDescription>{o ? CHANNELS[o.channel] + " · créée le " + time(o.created_at) : "Chargement…"}</DialogDescription>
        </DialogHeader>
        {q.isError ? (
          <FormError message={safeError(q.error)} />
        ) : !o ? (
          <Loading />
        ) : (
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{o.customer_name}</p>
                <a href={"tel:" + o.phone} className="num text-sm text-primary">
                  {o.phone}
                </a>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs text-muted-foreground">Livraison {o.delivery_type === "desk" ? "en point de retrait" : "à domicile"}</p>
                <p className="mt-1 font-semibold">
                  {o.wilaya} · {o.commune || "Commune à compléter"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{o.address || "Adresse à compléter"}</p>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs text-muted-foreground">Source & affectation</p>
                <p className="mt-1 font-semibold">
                  {CHANNELS[o.channel]} · {s.memberName(o.assigned_to)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{o.source_detail || "Aucun détail de source ajouté."}</p>
              </div>
            </div>
            <ItemsSummary o={o} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="num text-muted-foreground">
                Frais {money(o.fee)} · Remise {money(o.discount)}
              </span>
              <b className="num text-xl">{money(o.total)}</b>
            </div>
            {s.manager && (
              <div>
                <Button variant="outline" onClick={() => ui.assign([{ id: o.id, version: o.version }], o.assigned_to)}>
                  <Users />
                  Affecter à un agent
                </Button>
              </div>
            )}
            <SourcePanels o={o} />
            <OrderActions o={o} />
            <NoteForm o={o} />
            <OrderHistory o={o} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------ order form */

type Line = { key: string; product_id: string; quantity: number; unit_price: number | "" }
let lineSeq = 0
const newLine = (l: Partial<Line> = {}): Line => ({ key: "l" + ++lineSeq, product_id: "", quantity: 1, unit_price: "", ...l })

function OrderFormDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useSession()
  const qc = useQueryClient()
  const detail = useOrderDetail(id)
  const [products, setProducts] = useState<Product[] | null>(null)
  const cache = useRef(new Map<string, Product>())
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [fee, setFee] = useState<string>("0")
  const [discount, setDiscount] = useState<string>("0")
  const [search, setSearch] = useState("")
  const [dupHint, setDupHint] = useState("")
  const [ready, setReady] = useState(false)
  const { error, busy, run } = useSubmit()
  const o = detail.data

  // Initial catalogue; editing also loads the products already on the order so their names stay visible.
  useEffect(() => {
    let alive = true
    searchProducts(s.store!).then((list) => {
      if (!alive) return
      list.forEach((p) => cache.current.set(p.id, p))
      setProducts(list)
    }, () => setProducts([]))
    return () => {
      alive = false
    }
  }, [s.store])

  useEffect(() => {
    if (!id) return setReady(true)
    if (!o || ready) return
    setLines(o.items.map((i) => newLine({ product_id: i.product_id, quantity: i.quantity, unit_price: Number(i.unit_price) })))
    setFee(String(o.fee ?? 0))
    setDiscount(String(o.discount ?? 0))
    o.items.forEach((i) => {
      if (!cache.current.has(i.product_id))
        cache.current.set(i.product_id, { id: i.product_id, name: i.product_name, sku: i.sku, price: Number(i.unit_price), stock: 0, reserved: 0, version: 0, store_id: s.store! })
    })
    setReady(true)
  }, [id, o, ready, s.store])

  useEffect(() => {
    if (search === "") return
    const t = setTimeout(async () => {
      try {
        const list = await searchProducts(s.store!, search)
        list.forEach((p) => cache.current.set(p.id, p))
        setProducts(list)
      } catch (e) {
        toast.error(safeError(e))
      }
    }, 300)
    return () => clearTimeout(t)
  }, [search, s.store])

  const total = orderAmount(
    lines.map((l) => ({ unit_price: Number(l.unit_price) || 0, quantity: l.quantity || 0 })),
    Number(fee) || 0,
    Number(discount) || 0,
  )

  function checkPhone(value: string) {
    let phone = value.replace(/[\s().-]/g, "")
    if (/^0[567]\d{8}$/.test(phone)) phone = "+213" + phone.slice(1)
    if (!/^\+\d{8,15}$/.test(phone)) return setDupHint("")
    rpc<{ items: Order[] }>("crm_list_orders", { p_store: s.store, p_query: phone, p_size: 100 })
      .then((r) => {
        const others = r.items.filter((x) => x.id !== id)
        setDupHint(others.length ? `${others.length} commande(s) visible(s) utilisent déjà ce numéro. Vérifiez avant de créer un doublon.` : "")
      })
      .catch(() => {})
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    run(async () => {
      const payload: Record<string, unknown> = {
        customer_name: d.customer_name,
        phone: d.phone,
        wilaya: d.wilaya,
        commune: d.commune,
        address: d.address,
        delivery_type: d.delivery_type,
        channel: d.channel,
        source_detail: d.source_detail,
        store_id: s.store,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
        fee: Number(fee),
        discount: Number(discount),
      }
      if (!id && s.manager) payload.assigned_to = d.assigned_to || ""
      if (id && o) {
        payload.id = id
        payload.version = o.version
      }
      await s.command(id ? "order.edit" : "order.create", payload)
      toast.success("Commande enregistrée.")
      await qc.invalidateQueries({ queryKey: ["store", s.store] })
      onClose()
    })
  }

  const options = (current: string) => {
    const chosen = cache.current.get(current)
    return [...new Map([...(chosen ? [chosen] : []), ...(products || [])].map((p) => [p.id, p])).values()]
  }

  const loading = products === null || (id && !ready)
  const noCatalog = !loading && !id && products!.length === 0 && search === ""
  const data = o || ({} as Partial<Order>)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{id ? "Modifier #" + (o ? orderCode(o) : "") : "Nouvelle commande"}</DialogTitle>
          <DialogDescription>Le montant COD est recalculé côté serveur à l’enregistrement.</DialogDescription>
        </DialogHeader>
        {detail.isError ? (
          <FormError message={safeError(detail.error)} />
        ) : loading ? (
          <Loading />
        ) : noCatalog ? (
          <EmptyState
            title="Ajoutez votre premier produit"
            description="Une commande doit contenir au moins un produit du catalogue."
            action={
              s.manager ? (
                <Button asChild>
                  <a href="#products" onClick={onClose}>
                    <Plus />
                    Créer un produit
                  </a>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <form id="order-form" className="grid gap-6" onSubmit={submit}>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-sm font-semibold">Client & livraison</legend>
              <FormField label="Nom du client" htmlFor="o-name" required>
                <Input id="o-name" name="customer_name" defaultValue={data.customer_name} required minLength={2} maxLength={100} autoComplete="name" />
              </FormField>
              <FormField label="Téléphone" htmlFor="o-phone" required hint={dupHint ? <span className="text-warning">{dupHint}</span> : undefined}>
                <Input
                  id="o-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={data.phone}
                  required
                  maxLength={25}
                  placeholder="0555 12 34 56"
                  autoComplete="tel"
                  className="num"
                  onBlur={(e) => checkPhone(e.target.value)}
                />
              </FormField>
              <FormField label="Wilaya" htmlFor="o-wilaya" required>
                <Input id="o-wilaya" name="wilaya" defaultValue={data.wilaya} required minLength={2} maxLength={80} />
              </FormField>
              <FormField label="Commune" htmlFor="o-commune">
                <Input id="o-commune" name="commune" defaultValue={data.commune} maxLength={100} />
              </FormField>
              <FormField label="Adresse / point de retrait" htmlFor="o-address">
                <Input id="o-address" name="address" defaultValue={data.address} maxLength={500} />
              </FormField>
              <FormField label="Type de livraison" htmlFor="o-delivery">
                <NativeSelect id="o-delivery" name="delivery_type" defaultValue={data.delivery_type || "home"}>
                  <NativeSelectOption value="home">Domicile</NativeSelectOption>
                  <NativeSelectOption value="desk">Point de retrait</NativeSelectOption>
                </NativeSelect>
              </FormField>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="mb-3 text-sm font-semibold">Articles</legend>
              <div className="relative">
                <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden />
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un produit à ajouter…" aria-label="Chercher dans le catalogue" className="pl-9" />
              </div>
              <p className="text-xs text-muted-foreground">La liste affiche jusqu’à 80 résultats. Recherchez un produit pour affiner.</p>
              {lines.map((l, idx) => (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_88px_120px_44px] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_72px_44px]">
                  <NativeSelect
                    required
                    aria-label={"Produit, ligne " + (idx + 1)}
                    value={l.product_id}
                    onChange={(e) => {
                      const p = cache.current.get(e.target.value)
                      setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, product_id: e.target.value, unit_price: p ? Number(p.price) : "" } : x)))
                    }}
                  >
                    <NativeSelectOption value="">Choisir un produit</NativeSelectOption>
                    {options(l.product_id).map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.name} · {p.sku}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    required
                    aria-label={"Quantité, ligne " + (idx + 1)}
                    className="num"
                    value={l.quantity}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: Number(e.target.value) } : x)))}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    required
                    readOnly={!s.manager}
                    aria-label={"Prix unitaire, ligne " + (idx + 1)}
                    className="num max-sm:col-span-2 max-sm:row-start-2"
                    value={l.unit_price}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unit_price: e.target.value === "" ? "" : Number(e.target.value) } : x)))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    aria-label={"Retirer l’article, ligne " + (idx + 1)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                  <Plus />
                  Ajouter un article
                </Button>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-sm font-semibold">Source & affectation</legend>
              <FormField label="Canal de la commande" htmlFor="o-channel">
                <NativeSelect id="o-channel" name="channel" defaultValue={data.channel || "manual"}>
                  {Object.entries(CHANNELS).map(([k, v]) => (
                    <NativeSelectOption key={k} value={k}>
                      {v}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              {s.manager && !id && (
                <FormField label="Agent" htmlFor="o-agent">
                  <NativeSelect id="o-agent" name="assigned_to" defaultValue="">
                    <NativeSelectOption value="">Non attribué</NativeSelectOption>
                    {s.members.filter((m) => m.active).map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
              <FormField label="Détail de la source / référence de conversation" htmlFor="o-source" className="sm:col-span-2">
                <Input id="o-source" name="source_detail" defaultValue={data.source_detail} maxLength={500} />
              </FormField>
              <FormField label="Frais de livraison (DA)" htmlFor="o-fee" required>
                <Input id="o-fee" type="number" min={0} step={0.01} required value={fee} onChange={(e) => setFee(e.target.value)} className="num" />
              </FormField>
              <FormField label="Remise (DA)" htmlFor="o-discount" required hint={!s.manager ? "Un agent utilise le prix du catalogue, sans remise." : undefined}>
                <Input id="o-discount" type="number" min={0} step={0.01} required readOnly={!s.manager} value={discount} onChange={(e) => setDiscount(e.target.value)} className="num" />
              </FormField>
            </fieldset>

            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <b>Montant COD</b>
              <span className="num text-xl font-semibold" aria-live="polite">
                {money(total)}
              </span>
            </div>
            <FormError message={error} />
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          {!loading && !noCatalog && !detail.isError && (
            <Button type="submit" form="order-form" disabled={busy} aria-busy={busy}>
              Enregistrer la commande
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
