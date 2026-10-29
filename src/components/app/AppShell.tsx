import { useCallback, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Archive, BarChart3, Bolt, Box, ChevronDown, ChevronRight, LayoutGrid, Link2, LineChart, Menu, MessageSquare,
  Moon, Phone, RefreshCw, Search, Settings, Shield, ShoppingBag, Store, Sun, Truck, Undo2, Users, Wallet, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BrandMark } from "@/components/app/tone"
import { FormError } from "@/components/app/page"
import { CommandMenu, useCommandShortcut } from "@/components/app/command-menu"
import { Notifications } from "@/components/app/notifications"
import { AccountMenu } from "@/components/app/account-menu"
import { useOverview } from "@/lib/queries"
import { useLiveSync, useOnline } from "@/lib/live"
import type { RouteState } from "@/lib/router"
import { useSession } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { rpc, safeError } from "@/lib/api"
import { f } from "@/lib/format"
import { cn } from "@/lib/utils"

type NavItem = [id: string, label: string, Icon: typeof LayoutGrid]
export const NAV: [string, NavItem[]][] = [
  ["Pilotage", [["dashboard", "Vue d’ensemble", LayoutGrid], ["performance", "Performance & rapports", BarChart3]]],
  ["Opérations", [["orders", "Commandes", ShoppingBag], ["confirmation", "Confirmation", Phone], ["shipping", "Livraisons", Truck], ["returns", "Retours & échanges", Undo2]]],
  ["Business", [["products", "Produits & stock", Box], ["clients", "Clients", Users], ["purchases", "Achats & fournisseurs", Archive], ["finance", "Finances", Wallet]]],
  ["Croissance", [["ads", "Publicité & tracking", LineChart], ["suite", "Suite COD & tracking", Zap], ["messages", "Messagerie", MessageSquare], ["automation", "Automatisations", Bolt]]],
  ["Espace de travail", [["team", "Équipe & accès", Shield], ["integrations", "Intégrations", Link2], ["pos", "Point de vente", Store], ["settings", "Paramètres", Settings]]],
]
export const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([id, label]) => [id, label])))
// Modules connected to the backend. The others are planned and show no data.
export const LIVE_PAGES = new Set(["dashboard", "performance", "orders", "confirmation", "shipping", "products", "team", "integrations", "settings"])

// Planned modules are grouped, collapsed, under "Bientôt" so the menu shows what works first (UX audit 28/10/2026).
const PLANNED: NavItem[] = NAV.flatMap(([, items]) => items.filter(([id]) => !LIVE_PAGES.has(id)))
const SOON_KEY = "weconvert.nav.soon"

function NavLink({ item: [id, label, Icon], route, count, onNavigate, muted }: { item: NavItem; route: string; count?: number; onNavigate?: () => void; muted?: boolean }) {
  const active = route === id
  return (
    <a
      href={"#" + id}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 coarse:min-h-11 items-center gap-3 rounded-md px-3 text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : muted ? "text-muted-foreground" : "text-sidebar-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="num rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">{f(count)}</span>}
    </a>
  )
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function SidebarContent({ route, onNavigate }: { route: string; onNavigate?: () => void }) {
  const s = useSession()
  const overview = useOverview().data
  const counts: Record<string, number | undefined> = { confirmation: overview?.pending }
  const [storeOpen, setStoreOpen] = useState(false)
  const [soonOpen, setSoonOpen] = useState(() => {
    try {
      return localStorage.getItem(SOON_KEY) === "1"
    } catch {
      return false
    }
  })
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <a href="#dashboard" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BrandMark />
        <span>
          <span className="block text-base font-bold tracking-tight">WeConvert</span>
          <span className="block text-xs font-medium text-muted-foreground">Espace COD</span>
        </span>
      </a>
      <button
        type="button"
        onClick={() => setStoreOpen(true)}
        className="flex min-h-11 coarse:min-h-12 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-8 place-items-center rounded-md bg-secondary text-secondary-foreground">
          <Store className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{s.storeName}</span>
          <span className="block truncate text-xs text-muted-foreground">{s.workspaceName}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </button>
      <nav aria-label="Navigation principale" className="-mx-1 flex-1 overflow-y-auto px-1 pb-2">
        {NAV.map(([group, items]) => {
          const live = items.filter(([id]) => LIVE_PAGES.has(id))
          if (!live.length) return null
          return (
            <div key={group} className="mt-3">
              <div className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{group}</div>
              {live.map((item) => (
                <NavLink key={item[0]} item={item} route={route} count={counts[item[0]]} onNavigate={onNavigate} />
              ))}
            </div>
          )
        })}
        <details
          className="group mt-3"
          open={soonOpen || PLANNED.some(([id]) => id === route)}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open
            setSoonOpen(open)
            try {
              localStorage.setItem(SOON_KEY, open ? "1" : "0")
            } catch {}
          }}
        >
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Bientôt
            <span className="num ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium normal-case tracking-normal">{PLANNED.length}</span>
          </summary>
          {PLANNED.map((item) => (
            <NavLink key={item[0]} item={item} route={route} onNavigate={onNavigate} muted />
          ))}
        </details>
      </nav>
      <AccountMenu variant="sidebar" onNavigate={onNavigate} />
      <StoreSwitcher open={storeOpen} onOpenChange={setStoreOpen} />
    </div>
  )
}

export function StoreSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSession()
  const [error, setError] = useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choisir votre boutique</DialogTitle>
          <DialogDescription>Les commandes, le stock et les rapports affichés suivent la boutique choisie.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {s.stores.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => {
                s.selectStore(st.id)
                onOpenChange(false)
              }}
              className="flex min-h-11 coarse:min-h-12 items-center gap-3 rounded-lg border px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Store className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 font-medium">{st.name}</span>
              {st.id === s.store ? <span className="text-xs font-medium text-primary">Active</span> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
            </button>
          ))}
          {s.workspaces.length > 1 && (
            <>
              <p className="mt-3 text-sm font-semibold">Changer d’entreprise</p>
              {s.workspaces.map((w) => (
                <Button
                  key={w.id}
                  variant={w.id === s.workspace ? "secondary" : "outline"}
                  onClick={async () => {
                    try {
                      await s.selectWorkspace(w.id)
                      onOpenChange(false)
                    } catch (e) {
                      setError(safeError(e))
                    }
                  }}
                >
                  {w.name}
                </Button>
              ))}
            </>
          )}
          <FormError message={error} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LiveBadge({ state }: { state: string }) {
  const online = useOnline()
  const connected = online && state === "connected"
  return (
    <span role="status" aria-live="polite" className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:inline-flex">
      <span aria-hidden className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-warning")} />
      {!online ? "Hors ligne" : connected ? "En direct" : state === "retrying" ? "Reconnexion…" : "Connexion…"}
    </span>
  )
}

const MOBILE_NAV: NavItem[] = [
  ["dashboard", "Accueil", LayoutGrid],
  ["orders", "Commandes", ShoppingBag],
  ["confirmation", "Confirmer", Phone],
  ["products", "Stock", Box],
]

function InvitationDialog() {
  const s = useSession()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={s.hasInvitation} onOpenChange={(o) => !o && !busy && s.discardInvitation()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rejoindre un espace</DialogTitle>
          <DialogDescription>Vous avez ouvert un lien d’invitation. Rejoignez l’équipe avec le compte {s.user?.email}.</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => s.discardInvitation()}>
            Plus tard
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError("")
              try {
                const id = await rpc<string>("crm_accept_invitation", { p_token: sessionStorage.getItem("wc-invitation") })
                s.discardInvitation()
                await s.loadContext(id)
              } catch (e) {
                setError(safeError(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Accepter l’invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AppShell({ route, children }: { route: RouteState; children: ReactNode }) {
  const s = useSession()
  const qc = useQueryClient()
  const { theme, toggle } = useTheme()
  const live = useLiveSync()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const openSearch = useCallback(() => setSearch(true), [])
  useCommandShortcut(openSearch)

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Aller au contenu
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r bg-sidebar lg:block">
        <SidebarContent route={route.route} />
      </aside>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-[300px] bg-sidebar p-0 pl-[env(safe-area-inset-left)]">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Navigation de l’espace WeConvert</SheetDescription>
          </SheetHeader>
          <SidebarContent route={route.route} onNavigate={() => setMenu(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenu(true)} aria-label="Ouvrir le menu" aria-expanded={menu}>
            <Menu />
          </Button>
          <nav aria-label="Fil d’Ariane" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Workspace</span>
            <ChevronRight className="hidden size-4 sm:inline" aria-hidden />
            <b className="truncate font-semibold text-foreground">{TITLES[route.route]}</b>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button variant="outline" className="hidden min-w-64 justify-start text-muted-foreground md:inline-flex" onClick={openSearch} aria-keyshortcuts="Control+K Meta+K">
              <Search />
              Rechercher une commande
              <kbd className="ml-auto rounded border bg-muted px-1.5 font-sans text-xs">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden" onClick={openSearch} aria-label="Rechercher une commande">
              <Search />
            </Button>
            <Notifications />
            <LiveBadge state={live.state} />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["store", s.store] })} aria-label="Actualiser les données">
              <RefreshCw />
            </Button>
            <AccountMenu onSearch={openSearch} />
          </div>
        </header>
        <CommandMenu open={search} onOpenChange={setSearch} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
        <footer className="hidden flex-wrap justify-between gap-2 border-t px-8 py-4 text-xs text-muted-foreground lg:flex">
          <span>WeConvert · Votre commerce, sous contrôle.</span>
          <span className="num">
            {live.lastSync ? "Actualisé à " + new Date(live.lastSync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "CRM connecté"} ·{" "}
            {s.manager ? "Boutique sélectionnée" : "Vos commandes affectées"}
          </span>
        </footer>
      </div>
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden">
        {MOBILE_NAV.map(([id, label, Icon]) => (
          <a
            key={id}
            href={"#" + id}
            aria-current={route.route === id ? "page" : undefined}
            className={cn("grid min-h-14 content-center justify-items-center gap-0.5 text-xs font-medium outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", route.route === id ? "text-primary" : "text-muted-foreground")}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </a>
        ))}
        <button type="button" onClick={() => setMenu(true)} className="grid min-h-14 content-center justify-items-center gap-0.5 text-xs font-medium text-muted-foreground outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <Menu className="size-5" aria-hidden />
          Menu
        </button>
      </nav>
      <InvitationDialog />
    </div>
  )
}
