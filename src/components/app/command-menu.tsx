import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ArrowRight, Plus } from "lucide-react"
import { initialsOf } from "@domain/domain.mjs"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, Kbd } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { NAV, LIVE_PAGES } from "@/components/app/AppShell"
import { StatusBadge } from "@/components/app/tone"
import { useOrderUI } from "@/components/app/orders"
import { rpc } from "@/lib/api"
import { money, orderCode } from "@/lib/format"
import { boardArgs } from "@/lib/queries"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import type { OrderBoard } from "@/lib/types"

/** Opens the search on Ctrl+K / ⌘K anywhere, except while typing in another field. */
export function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      open()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
}

/**
 * Global search (Ctrl+K / ⌘K): orders by customer, phone, number, wilaya or tracking (server search under RLS,
 * so an agent only finds their own orders), pages, and the "new order" action. Keyboard: ↑ ↓ to move, Entrée to open.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useSession()
  const ui = useOrderUI()
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (!open) setQ("")
  }, [open])

  const results = useQuery({
    queryKey: ["store", s.store, "command", query],
    queryFn: () => rpc<OrderBoard>("crm_order_board", boardArgs(s.store, { stage: "all", status: "all", q: query, page: 1, size: 8, agent: "", ascending: false })),
    enabled: open && !!s.store,
    placeholderData: keepPreviousData,
  })
  const orders = results.data?.items || []
  const pages = NAV.flatMap(([, items]) => items)
    .filter(([id]) => LIVE_PAGES.has(id))
    .filter(([, label]) => !q || label.toLowerCase().includes(q.trim().toLowerCase()))

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Rechercher</DialogTitle>
        <DialogDescription className="sr-only">Rechercher une commande par client, téléphone, numéro, wilaya ou suivi, ou ouvrir une page.</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput value={q} onValueChange={setQ} placeholder="Client, téléphone, n° de commande, wilaya, suivi…" aria-label="Rechercher" />
          <CommandList>
            <CommandEmpty>{results.isFetching ? "Recherche…" : results.isError ? "Recherche indisponible pour le moment." : "Aucun résultat pour « " + q + " »."}</CommandEmpty>
            {orders.length > 0 && (
              <CommandGroup heading={query ? "Commandes" : "Dernières commandes"}>
                {orders.map((o) => (
                  <CommandItem key={o.id} value={"order-" + o.id} onSelect={() => run(() => ui.openOrder(o.id))}>
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                      {initialsOf(o.customer_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.customer_name}</span>
                      <span className="num block truncate text-xs text-muted-foreground">
                        #{orderCode(o)} · {o.phone} · {o.wilaya}
                      </span>
                    </span>
                    <span className="num hidden text-sm font-medium sm:inline">{money(o.total)}</span>
                    <StatusBadge status={o.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(orders.length > 0 || pages.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Actions">
              <CommandItem value="new-order" onSelect={() => run(ui.newOrder)}>
                <Plus />
                Nouvelle commande
              </CommandItem>
            </CommandGroup>
            {pages.length > 0 && (
              <CommandGroup heading="Pages">
                {pages.map(([id, label, Icon]) => (
                  <CommandItem key={id} value={"page-" + id} onSelect={() => run(() => navigate(id))}>
                    <Icon />
                    {label}
                    <ArrowRight className="ml-auto" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              Naviguer
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Entrée</Kbd>
              Ouvrir
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Échap</Kbd>
              Fermer
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
