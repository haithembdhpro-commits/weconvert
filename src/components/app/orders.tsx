import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, ChevronDown, ChevronRight, Clock, Copy, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, RotateCcw, Search, Users, X } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { WILAYAS } from "@/lib/wilayas"

/* ---------------------------------------------------------------- contact */

/** wa.me expects the international number without "+" ; local 05/06/07 numbers become 213… */
export function waLink(phone: string) {
  let d = (phone || "").replace(/\D/g, "")
  if (/^0[567]\d{8}$/.test(d)) d = "213" + d.slice(1)
  return "https://wa.me/" + d
}

/**
 * Call, WhatsApp and copy for a customer phone. `full` shows labelled buttons (call sheet, order card);
 * otherwise compact icon buttons (lists). Clicks never open the row behind.
 */
export function ContactActions({ phone, full = false, className }: { phone: string; full?: boolean; className?: string }) {
  if (!phone) return null
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(phone)
      toast.success("Numéro copié : " + phone)
    } catch {
      toast.error("Copie impossible : sélectionnez le numéro à la main.")
    }
  }
  if (full)
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Button asChild>
          <a href={"tel:" + phone} onClick={stop}>
            <Phone />
            Appeler
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={waLink(phone)} target="_blank" rel="noopener noreferrer" onClick={stop}>
            <MessageCircle />
            WhatsApp
          </a>
        </Button>
        <Button variant="outline" onClick={copy}>
          <Copy />
          Copier
        </Button>
      </div>
    )
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      <Button variant="ghost" size="icon-sm" asChild>
        <a href={"tel:" + phone} onClick={stop} aria-label={"Appeler le " + phone} title="Appeler">
          <Phone />
        </a>
      </Button>
      <Button variant="ghost" size="icon-sm" asChild>
        <a href={waLink(phone)} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={"Écrire sur WhatsApp au " + phone} title="WhatsApp">
          <MessageCircle />
        </a>
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={"Copier le " + phone} title="Copier le numéro">
        <Copy />
      </Button>
    </span>
  )
}

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
  if (ui.queued.has(o.id)) return <ToneBadge tone="success">Confirmée · envoi…</ToneBadge>
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
              Annuler la commande…
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel>Statut actuel : {STATUS[o.status]?.[0] || o.status}</DropdownMenuLabel>
            {canReopen && (
              <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.setStatus(o, "new")}>
                Rouvrir la commande…
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem className="min-h-8 coarse:min-h-10" variant="destructive" onSelect={() => ui.setStatus(o, "cancelled")}>
                Annuler la commande…
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
  loading = false,
  error,
  onRetry,
}: {
  orders: Order[]
  compact?: boolean
  selected?: Set<string>
  onToggle?: (id: string, on: boolean) => void
  onToggleAll?: (on: boolean) => void
  columns?: Set<string>
  /** First load in progress: never show "no order" before the server answered. */
  loading?: boolean
  error?: unknown
  onRetry?: () => void
}) {
  const s = useSession()
  const ui = useOrderUI()
  const selectable = !compact && s.manager && !!selected
  const someOn = selectable && orders.some((o) => selected!.has(o.id))
  const allOn = selectable && orders.length > 0 && orders.every((o) => selected!.has(o.id))
  const show = (k: string) => columns.has(k) && !(compact && (k === "agent" || k === "source" || k === "product" || k === "wilaya"))
  if (error && !orders.length)
    return (
      <div className="grid justify-items-start gap-3 p-5">
        <Notice tone="danger" role="alert">
          Liste indisponible : {safeError(error)}
        </Notice>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw />
            Réessayer
          </Button>
        )}
      </div>
    )
  if (loading && !orders.length) return <Loading text="Chargement des commandes…" />
  if (!orders.length) return <EmptyState title="Aucune commande" description="Ajoutez une commande ou adaptez votre recherche." />
  return (
    <>
    {/* Phones: one card per order, the agent's main format. */}
    <ul className="divide-y md:hidden">
      {orders.map((o) => (
        <li key={o.id} className="flex items-start gap-3 px-4 py-3">
          {selectable && (
            <label className="-m-3 grid size-11 shrink-0 place-items-center">
              <Checkbox checked={selected!.has(o.id)} onCheckedChange={(v) => onToggle?.(o.id, !!v)} aria-label={"Sélectionner " + orderCode(o)} className="size-5" />
            </label>
          )}
          <div className="grid min-w-0 flex-1 gap-1">
          <button type="button" onClick={() => ui.openOrder(o.id)} className="grid min-w-0 gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
          <ContactActions phone={o.phone} className="-ml-2" />
          </div>
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
                <Checkbox checked={allOn ? true : someOn ? "indeterminate" : false} onCheckedChange={(v) => onToggleAll?.(!!v && !someOn)} aria-label="Sélectionner la page" className="size-5" />
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
                  {!compact && <ContactActions phone={o.phone} className="ml-auto" />}
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
  /** Resolves true once the callback is saved, false if the dialog was closed. */
  callback: (o: Order) => Promise<boolean>
  /** Resolves true when the change is accepted (a confirmation is queued for UNDO_MS, then sent), false otherwise. */
  setStatus: (o: Order, status: string) => Promise<boolean>
  noAnswer: (o: Order, attempt?: number) => Promise<boolean>
  /** Orders whose confirmation is waiting for the undo delay. */
  queued: Set<string>
}

/** Delay during which a confirmation can be undone from its toast before it is sent. */
const UNDO_MS = 5000
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
  // Resolves the promise of the reason / callback dialog currently open.
  const settle = useRef<((ok: boolean) => void) | null>(null)
  const finish = (ok: boolean) => {
    settle.current?.(ok)
    settle.current = null
  }
  const [queued, setQueued] = useState<Set<string>>(new Set())
  const pendingSends = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => Promise<void> }>())

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["store", s.store] }), [qc, s.store])

  const mutate = useCallback(
    async (action: string, payload: Record<string, unknown>, done: string) => {
      await s.command(action, payload)
      toast.success(done)
      await refresh()
    },
    [s, refresh],
  )

  const unqueue = useCallback((id: string) => {
    pendingSends.current.delete(id)
    setQueued((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }, [])

  // A queued confirmation is never lost: it is sent at once when the tab is hidden or the provider unmounts
  // (store switch, logout), and closing the tab while one is waiting asks the browser to confirm.
  useEffect(() => {
    const flush = () => pendingSends.current.forEach((p) => p.send())
    const onHide = () => document.visibilityState === "hidden" && flush()
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!pendingSends.current.size) return
      flush()
      e.preventDefault()
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("beforeunload", onUnload)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("beforeunload", onUnload)
      flush()
    }
  }, [])

  const confirmWithUndo = useCallback(
    (o: Order) => {
      if (pendingSends.current.has(o.id)) return
      const code = "#" + orderCode(o)
      const send = async () => {
        const p = pendingSends.current.get(o.id)
        if (!p) return
        clearTimeout(p.timer)
        unqueue(o.id)
        try {
          await s.command("order.status", { id: o.id, version: o.version, status: "confirmed" })
        } catch (e) {
          toast.error(code + " n’a pas été confirmée : " + safeError(e))
        } finally {
          await refresh()
        }
      }
      pendingSends.current.set(o.id, { timer: setTimeout(send, UNDO_MS), send })
      setQueued((prev) => new Set(prev).add(o.id))
      toast.success(code + " confirmée", {
        description: o.customer_name + " · " + money(o.total),
        duration: UNDO_MS,
        action: {
          label: "Annuler",
          onClick: () => {
            const p = pendingSends.current.get(o.id)
            if (!p) return
            clearTimeout(p.timer)
            unqueue(o.id)
            toast(code + " : confirmation annulée.")
          },
        },
      })
    },
    [s, refresh, unqueue],
  )

  const ui = useMemo<Ui>(
    () => ({
      openOrder: (id) => setDetail(id),
      newOrder: () => setForm({ id: null }),
      editOrder: (id) => setForm({ id }),
      assign: (ids, current) => setAssignFor({ ids, current }),
      callback: (o) =>
        new Promise<boolean>((resolve) => {
          finish(false)
          settle.current = resolve
          setCallbackFor(o)
        }),
      setStatus: async (o, status) => {
        if (REASON_STATUSES.includes(status))
          return new Promise<boolean>((resolve) => {
            finish(false)
            settle.current = resolve
            setReason({ order: o, status })
          })
        if (status === "confirmed") {
          confirmWithUndo(o)
          return true
        }
        if (busy.current) return false
        busy.current = true
        try {
          await mutate("order.status", { id: o.id, version: o.version, status }, "#" + orderCode(o) + " : " + (STATUS[status]?.[0] || status) + ".")
          return true
        } catch (e) {
          toast.error(safeError(e))
          return false
        } finally {
          busy.current = false
        }
      },
      noAnswer: async (o, attempt) => {
        if (busy.current) return false
        busy.current = true
        try {
          const n = attempt || o.attempts + 1
          await mutate("order.call", attempt ? { id: o.id, version: o.version, attempt } : { id: o.id, version: o.version }, "#" + orderCode(o) + " : appel " + n + " sans réponse.")
          return true
        } catch (e) {
          toast.error(safeError(e))
          return false
        } finally {
          busy.current = false
        }
      },
      queued,
    }),
    [mutate, confirmWithUndo, queued],
  )

  const reasonTitle = (r: { order: Order; status: string }) =>
    ({ new: "Rouvrir la commande", cancelled: "Annuler la commande", duplicate: "Marquer comme doublon", fake: "Marquer comme faux numéro" })[r.status] + " #" + orderCode(r.order)

  return (
    <UiCtx.Provider value={ui}>
      {children}
      <OrderDetailDialog id={detail} onClose={() => setDetail(null)} />
      {form && <OrderFormDialog id={form.id} onClose={() => setForm(null)} />}
      {reason && (
        <ReasonDialog
          title={reasonTitle(reason)}
          status={reason.status}
          destructive={reason.status !== "new"}
          onClose={() => {
            setReason(null)
            finish(false)
          }}
          onSubmit={(text) =>
            mutate(
              "order.status",
              { id: reason.order.id, version: reason.order.version, status: reason.status, reason: text },
              "#" + orderCode(reason.order) + " : " + (STATUS[reason.status]?.[0] || reason.status) + ".",
            ).then(() => {
              setReason(null)
              finish(true)
            })
          }
        />
      )}
      {callbackFor && (
        <CallbackDialog
          onClose={() => {
            setCallbackFor(null)
            finish(false)
          }}
          onSubmit={(at, note) =>
            mutate(
              "order.callback",
              { id: callbackFor.id, version: callbackFor.version, callback_at: localInputToISO(at), note },
              "#" + orderCode(callbackFor) + " : rappel prévu le " + time(localInputToISO(at)) + ".",
            ).then(() => {
              setCallbackFor(null)
              finish(true)
            })
          }
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
            if (done) toast.success(done > 1 ? done + " commandes affectées." : "Commande affectée.")
            if (failures.length) toast.error((failures.length > 1 ? failures.length + " commandes refusées : " : "Commande refusée : ") + safeError(failures[0]))
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

const REASON_PRESETS: Record<string, string[]> = {
  cancelled: ["Client a refusé la commande", "Prix trop élevé", "Délai de livraison trop long", "A déjà commandé ailleurs", "Commande passée par erreur"],
  fake: ["Numéro inexistant ou hors service", "Numéro d’une autre personne", "Le client nie avoir commandé"],
  duplicate: ["Même client, même produit", "Commande déjà confirmée sous un autre numéro"],
  new: ["Le client a rappelé", "Statut choisi par erreur"],
}

function ReasonDialog({
  title, status, destructive, onClose, onSubmit,
}: { title: string; status: string; destructive?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const { error, busy, run } = useSubmit()
  const [text, setText] = useState("")
  const presets = REASON_PRESETS[status] || []
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
            run(() => onSubmit(text.trim()))
          }}
        >
          {presets.length > 0 && (
            <div role="group" aria-label="Motifs fréquents" className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button key={p} type="button" size="sm" variant={text === p ? "secondary" : "outline"} aria-pressed={text === p} onClick={() => setText(p)}>
                  {p}
                </Button>
              ))}
            </div>
          )}
          <FormField label="Motif" htmlFor="reason" required hint="Choisissez un motif fréquent ou précisez-le.">
            <Textarea id="reason" name="reason" required minLength={2} maxLength={2000} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Retour
          </Button>
          <Button type="submit" form="reason-form" variant={destructive ? "destructive" : "default"} disabled={busy || text.trim().length < 2} aria-busy={busy}>
            {title.split(" #")[0]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "YYYY-MM-DDTHH:mm" in the device time zone, for datetime-local inputs. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function callbackShortcuts(now = new Date()) {
  const inHour = new Date(now.getTime() + 60 * 60 * 1000)
  const evening = new Date(now)
  evening.setHours(18, 0, 0, 0)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)
  return [
    ["Dans 1 h", inHour],
    ...(evening.getTime() - now.getTime() > 30 * 60 * 1000 ? [["Ce soir 18:00", evening] as [string, Date]] : []),
    ["Demain 10:00", tomorrow],
  ] as [string, Date][]
}

function CallbackDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (at: string, note: string) => Promise<unknown> }) {
  const { error, busy, run } = useSubmit()
  const [at, setAt] = useState("")
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Planifier un rappel</DialogTitle>
          <DialogDescription>{tz === "Africa/Algiers" ? "Heure d’Alger." : "Heure de votre appareil (" + tz + ")."}</DialogDescription>
        </DialogHeader>
        <form
          id="callback-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const d = new FormData(e.currentTarget)
            run(() => onSubmit(at, String(d.get("note") || "")))
          }}
        >
          <div role="group" aria-label="Raccourcis" className="flex flex-wrap gap-2">
            {callbackShortcuts().map(([label, d]) => {
              const v = localInput(d)
              return (
                <Button key={label} type="button" size="sm" variant={at === v ? "secondary" : "outline"} aria-pressed={at === v} onClick={() => setAt(v)}>
                  {label}
                </Button>
              )
            })}
          </div>
          <FormField label="Date et heure du rappel" htmlFor="cb-at" required>
            <Input id="cb-at" name="callback_at" type="datetime-local" required min={localInput(new Date())} value={at} onChange={(e) => setAt(e.target.value)} />
          </FormField>
          <FormField label="Note" htmlFor="cb-note">
            <Input id="cb-note" name="note" maxLength={2000} placeholder="Disponible après 17 h, rappeler au travail…" />
          </FormField>
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Retour
          </Button>
          <Button type="submit" form="callback-form" disabled={busy || !at} aria-busy={busy}>
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

/**
 * Order actions, most frequent first: Confirmer · Sans réponse · Rappel, the rest under "Autres".
 * `onDone` fires after an accepted action (the call sheet uses it to move to the next order).
 */
export function OrderActions({ o, onDone, className }: { o: Order; onDone?: () => void; className?: string }) {
  const s = useSession()
  const ui = useOrderUI()
  const pending = PENDING.includes(o.status)
  const shipped = !!o.shipment && o.shipment.state !== "cancelled"
  const after = (p: Promise<boolean>) => p.then((ok) => ok && onDone?.())
  if (ui.queued.has(o.id))
    return <p className={cn("text-sm text-muted-foreground", className)}>Confirmation en cours d’envoi… (annulable depuis la notification)</p>
  if (pending)
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Button onClick={() => after(ui.setStatus(o, "confirmed"))}>
          <Check />
          Confirmer
        </Button>
        <Button variant="outline" onClick={() => after(ui.noAnswer(o))}>
          Sans réponse{o.attempts ? " (appel " + (o.attempts + 1) + ")" : ""}
        </Button>
        <Button variant="outline" onClick={() => after(ui.callback(o))}>
          <Clock />
          Rappel…
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost">
              <MoreHorizontal />
              Autres
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => ui.editOrder(o.id)}>
              <Pencil />
              Modifier la commande
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" disabled={o.status === "check"} onSelect={() => after(ui.setStatus(o, "check"))}>
              À vérifier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => after(ui.setStatus(o, "fake"))}>
              Faux numéro…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" onSelect={() => after(ui.setStatus(o, "duplicate"))}>
              Doublon…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8 coarse:min-h-10" variant="destructive" onSelect={() => after(ui.setStatus(o, "cancelled"))}>
              Annuler la commande…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  if (!s.manager) return null
  if (shipped) return <p className={cn("text-sm text-muted-foreground", className)}>Colis chez le transporteur : la commande ne peut plus être rouverte ni annulée.</p>
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button variant="outline" onClick={() => ui.setStatus(o, "new")}>
        Rouvrir la commande…
      </Button>
      {o.status === "confirmed" && (
        <Button variant="outline" className="text-danger hover:text-danger" onClick={() => ui.setStatus(o, "cancelled")}>
          Annuler la commande…
        </Button>
      )}
    </div>
  )
}

// Unsaved notes survive switching orders, closing the sheet or a live refresh (tab lifetime only).
const noteDrafts = new Map<string, string>()

export function NoteForm({ o }: { o: Order }) {
  const s = useSession()
  const qc = useQueryClient()
  const { error, busy, run } = useSubmit()
  const [note, setNoteState] = useState(() => noteDrafts.get(o.id) || "")
  const setNote = (v: string) => {
    setNoteState(v)
    if (v) noteDrafts.set(o.id, v)
    else noteDrafts.delete(o.id)
  }
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
      <h3 className="mb-3 text-sm font-semibold">Historique{(o.events || []).length ? " (" + (o.events || []).length + ")" : ""}</h3>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{o.customer_name}</p>
                <p className="num text-sm text-muted-foreground">{o.phone}</p>
              </div>
              <StatusMenu o={o} />
            </div>
            <ContactActions phone={o.phone} full />
            <OrderActions o={o} className="border-y py-4" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs text-muted-foreground">Livraison {o.delivery_type === "desk" ? "en point de retrait" : "à domicile"}</p>
                <p className="mt-1 font-semibold">
                  {o.wilaya} · {o.commune || <span className="text-warning">Commune à compléter</span>}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{o.address || <span className="text-warning">Adresse à compléter</span>}</p>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs text-muted-foreground">Source & affectation</p>
                <p className="mt-1 font-semibold">
                  {CHANNELS[o.channel]} · {s.memberName(o.assigned_to)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{o.source_detail || "Aucun détail de source ajouté."}</p>
                {s.manager && (
                  <Button variant="link" size="sm" className="mt-1 h-auto min-h-6 px-0 coarse:min-h-11" onClick={() => ui.assign([{ id: o.id, version: o.version }], o.assigned_to)}>
                    <Users />
                    Changer l’agent
                  </Button>
                )}
              </div>
            </div>
            <ItemsSummary o={o} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="num text-muted-foreground">
                Frais {money(o.fee)} · Remise {money(o.discount)}
              </span>
              <b className="num text-xl">{money(o.total)}</b>
            </div>
            <SourcePanels o={o} />
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
  const [dirty, setDirty] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const { error, busy, run } = useSubmit()
  const o = detail.data
  // Closing with unsaved input asks first: an order typed during a WhatsApp chat must not vanish on Esc or a stray click.
  const requestClose = () => {
    if (busy) return
    if (dirty) setLeaving(true)
    else onClose()
  }

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
    <>
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
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
          <form id="order-form" className="grid gap-6" onSubmit={submit} onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
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
                <NativeSelect id="o-wilaya" name="wilaya" defaultValue={data.wilaya || ""} required>
                  <NativeSelectOption value="">Choisir la wilaya</NativeSelectOption>
                  {data.wilaya && !WILAYAS.some((w) => w.value === data.wilaya) && <NativeSelectOption value={data.wilaya}>{data.wilaya} (valeur actuelle)</NativeSelectOption>}
                  {WILAYAS.map((w) => (
                    <NativeSelectOption key={w.code} value={w.value}>
                      {w.value}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
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
          <Button variant="outline" onClick={requestClose} disabled={busy}>
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
    <Dialog open={leaving} onOpenChange={setLeaving}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abandonner la saisie ?</DialogTitle>
          <DialogDescription>Les informations saisies dans cette commande ne sont pas enregistrées.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setLeaving(false)} autoFocus>
            Continuer la saisie
          </Button>
          <Button variant="destructive" onClick={onClose}>
            Abandonner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
