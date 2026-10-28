import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Bell, CalendarClock, PackageCheck, ShoppingBag, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOrderUI } from "@/components/app/orders"
import { rpc, safeError } from "@/lib/api"
import { orderCode } from "@/lib/format"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

type Item = { kind: string; at: string; order_id: string; number: number; customer_name: string; detail: string | null; unread: boolean }
type Feed = { seen_at: string | null; unread: number; items: Item[] }

const KINDS: Record<string, { label: string; icon: typeof Bell; note?: string }> = {
  "order.new": { label: "Nouvelle commande", icon: ShoppingBag },
  "callback.due": { label: "Rappel à faire", icon: CalendarClock },
  "parcel.delivered": { label: "Colis livré", icon: PackageCheck, note: "statut ZR, encaissement non vérifié" },
  "parcel.returned": { label: "Colis retourné", icon: Undo2, note: "statut ZR" },
}

function ago(at: string) {
  const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000)
  if (s < 60) return "à l’instant"
  if (s < 3600) return "il y a " + Math.round(s / 60) + " min"
  if (s < 86400) return "il y a " + Math.round(s / 3600) + " h"
  return "il y a " + Math.round(s / 86400) + " j"
}

/**
 * Header bell: new orders, due callbacks and parcels delivered/returned over 7 days (server feed under RLS,
 * refreshed by the live signal). "Tout marquer comme lu" is stored per user and store. The tab title shows the
 * unread count so an agent on another tab sees new work arrive.
 */
export function Notifications() {
  const s = useSession()
  const ui = useOrderUI()
  const qc = useQueryClient()
  const [only, setOnly] = useState(false)
  const feed = useQuery({
    queryKey: ["store", s.store, "notifications"],
    queryFn: () => rpc<Feed>("crm_notifications", { p_store: s.store }),
    enabled: !!s.store,
  })
  const unread = feed.data?.unread ?? 0
  const items = (feed.data?.items || []).filter((x) => !only || x.unread)

  // Tab title counter, restored on unmount. Applied after the commit so the page title set by App comes first.
  const base = useRef(document.title.replace(/^\(\d+\+?\)\s/, ""))
  useEffect(() => {
    queueMicrotask(() => {
      const clean = document.title.replace(/^\(\d+\+?\)\s/, "")
      base.current = clean
      document.title = unread ? `(${unread > 99 ? "99+" : unread}) ${clean}` : clean
    })
  })
  useEffect(() => () => void (document.title = base.current), [])

  async function markAll() {
    try {
      await rpc("crm_notifications_seen", { p_store: s.store })
      await qc.invalidateQueries({ queryKey: ["store", s.store, "notifications"] })
    } catch (e) {
      toast.error(safeError(e))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}>
          <Bell />
          {unread > 0 && (
            <span aria-hidden className="num absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.625rem] leading-none font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(400px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" disabled={!unread} onClick={markAll}>
            Tout marquer comme lu
          </Button>
        </div>
        <div role="group" aria-label="Filtre" className="flex gap-1 border-b px-3 py-2">
          {[
            [false, "Toutes"],
            [true, "Non lues" + (unread ? " (" + unread + ")" : "")],
          ].map(([v, label]) => (
            <Button key={String(v)} size="sm" variant={only === v ? "secondary" : "ghost"} aria-pressed={only === v} onClick={() => setOnly(v as boolean)}>
              {label as string}
            </Button>
          ))}
        </div>
        <div className="max-h-[min(420px,60dvh)] overflow-y-auto p-1">
          {feed.isError ? (
            <p className="p-4 text-sm text-danger">Notifications indisponibles : {safeError(feed.error)}</p>
          ) : !feed.data ? (
            <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
          ) : !items.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{only ? "Tout est lu." : "Rien de nouveau ces 7 derniers jours."}</p>
          ) : (
            items.map((x) => {
              const k = KINDS[x.kind] || { label: x.kind, icon: Bell }
              return (
                <DropdownMenuItem key={x.kind + x.order_id + x.at} className="items-start gap-3 py-2" onSelect={() => ui.openOrder(x.order_id)}>
                  <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", x.kind === "parcel.returned" ? "bg-danger-soft text-danger" : "bg-secondary text-secondary-foreground")}>
                    <k.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      <b className="font-medium">{k.label}</b> · {x.customer_name}
                    </span>
                    <span className="num block text-xs text-muted-foreground">
                      #{orderCode(x)} · {ago(x.at)}
                      {x.detail ? " · " + x.detail : ""}
                      {k.note ? " · " + k.note : ""}
                    </span>
                  </span>
                  {x.unread && (
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Non lue" />
                  )}
                </DropdownMenuItem>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
