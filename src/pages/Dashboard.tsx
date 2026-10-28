import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CalendarClock, CheckCircle2, ChevronRight, Phone, Plus, ShoppingBag, Truck, Users } from "lucide-react"
import { reportRange, reportRate } from "@domain/report-domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState, Notice, PageHeader } from "@/components/app/page"
import { OrdersTable, useOrderUI } from "@/components/app/orders"
import { rpc } from "@/lib/api"
import { f, money } from "@/lib/format"
import { useOrders, useOverview } from "@/lib/queries"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

function Stat({ label, value, meta, icon: Icon, href }: { label: string; value: string; meta: React.ReactNode; icon: typeof Phone; href: string }) {
  return (
    <a href={href} className="group grid min-w-0 gap-1 bg-card p-5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
        <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="num text-[1.75rem] font-semibold tracking-tight">{value}</span>
      <span className="text-[0.8125rem] leading-snug text-muted-foreground">{meta}</span>
    </a>
  )
}

function DaysChart({ days }: { days: { date: string; count: number }[] }) {
  if (!days.length) return <EmptyState title="Pas encore de données" description="Les commandes reçues apparaîtront ici par jour." />
  const max = Math.max(1, ...days.map((d) => Number(d.count) || 0))
  const label = days
    .map((d) => new Date(d.date + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " : " + f(d.count) + " commande(s)")
    .join(", ")
  return (
    <div role="img" aria-label={"Commandes créées : " + label} className="flex h-52 items-stretch gap-2 border-b sm:gap-3">
      {days.map((d, i) => {
        const n = Number(d.count) || 0
        const last = i === days.length - 1
        return (
          <div key={d.date} className="relative flex flex-1 flex-col items-center justify-end gap-1.5 pb-7">
            <span className={cn("num text-xs font-semibold", last ? "text-foreground" : "text-muted-foreground")}>{f(n)}</span>
            <div
              className={cn("w-full max-w-11 origin-bottom animate-in rounded-t-md fade-in slide-in-from-bottom-2 duration-500", last ? "bg-chart-1" : "bg-chart-2")}
              style={{ height: `${Math.max(n ? 4 : 1, (n / max) * 72)}%`, animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
            />
            <span className="num absolute bottom-0 text-xs text-muted-foreground">
              {new Date(d.date + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Dashboard() {
  const s = useSession()
  const ui = useOrderUI()
  const m = useOverview().data || {}
  const latest = useOrders({ status: "all", q: "", page: 1, agent: "", ascending: false, size: 5 })
  const range = reportRange("7")
  const delivered = useQuery({
    queryKey: ["store", s.store, "delivered7", range.from, range.to],
    queryFn: () => rpc<{ total: number }>("crm_delivered_period_page", { p_store: s.store, p_from: range.from, p_to: range.to, p_page: 1 }),
    enabled: !!s.store && s.manager,
  })
  const days = m.days || []
  const legacy = (Number(m.woo_confirmation_unverified) || 0) + (Number(m.woo_cancellation_unverified) || 0)
  const active = s.members.filter((x) => x.active).length

  const tasks = [
    { icon: Phone, n: m.pending, label: "commandes à confirmer", desc: "Vérifier les coordonnées et la disponibilité", href: "#confirmation" },
    { icon: CalendarClock, n: m.due, label: "rappels arrivés à échéance", desc: "Planifier les rappels", href: "#confirmation/due" },
    { icon: CheckCircle2, n: m.confirmed, label: "statuts confirmés", desc: "À vérifier pour l’historique Woo", href: "#orders/confirmed" },
  ]

  return (
    <>
      <PageHeader
        title="Votre activité, en un coup d’œil."
        description="Commandes, confirmation et rappels dans votre boutique."
        actions={
          <Button size="lg" onClick={ui.newOrder}>
            <Plus />
            Nouvelle commande
          </Button>
        }
      />
      <Card className={cn("grid gap-px overflow-hidden bg-border py-0", s.manager ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
        <Stat label="Commandes reçues" value={f(m.all)} meta={<><b className="num text-foreground">{f(m.today)}</b> reçues aujourd’hui</>} icon={ShoppingBag} href="#orders" />
        <Stat label="À confirmer" value={f(m.pending)} meta={`${f(m.pending)} sur ${f(m.all)} commandes visibles`} icon={Phone} href="#confirmation" />
        <Stat
          label="Taux de confirmation"
          value={reportRate(m.confirmed_verified, m.all)}
          meta={`${f(m.confirmed_verified)} vérifiées ÷ ${f(m.all)} reçues depuis l’ouverture`}
          icon={CheckCircle2}
          href="#orders/confirmed"
        />
        {s.manager && (
          <Stat label="Commandes livrées" value={delivered.data ? f(delivered.data.total) : "—"} meta="Créées ces 7 jours · statut ZR, reversement non vérifié" icon={Truck} href="#performance" />
        )}
      </Card>
      {legacy > 0 && (
        <Notice tone="warning" className="mt-4">
          {f(legacy)} statuts historiques (confirmations ou annulations) ont été déduits de WooCommerce sans décision COD vérifiée. Ces commandes restent visibles ; leurs statuts sont exclus
          des taux et montants du rapport jusqu’au rapprochement avec la source de confirmation d’origine.
        </Notice>
      )}
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="gap-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">Activité des commandes</h2>
              <p className="text-sm text-muted-foreground">Commandes créées · heure d’Alger</p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">7 derniers jours</span>
          </div>
          <p className="mt-4">
            <span className="num text-3xl font-semibold tracking-tight">{f(days.reduce((n, d) => n + (Number(d.count) || 0), 0))}</span>
            <span className="ml-2 text-sm text-muted-foreground">commandes sur cette période</span>
          </p>
          <div className="mt-4">
            <DaysChart days={days} />
          </div>
        </Card>
        <Card className="gap-0 p-5 sm:p-6">
          <h2 className="font-semibold">Votre journée</h2>
          <p className="text-sm text-muted-foreground">Les actions qui comptent maintenant</p>
          <ul className="mt-4 grid gap-1">
            {tasks.map((t) => (
              <li key={t.href}>
                <a href={t.href} className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                    <t.icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      <span className="num">{f(t.n)}</span> {t.label}
                    </span>
                    <span className="block text-sm text-muted-foreground">{t.desc}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <Notice className="mt-4">
            Valeur COD confirmée : <b className="num">{money(m.confirmed_verified_amount)}</b>. Les livraisons sont dans Performance ; le reversement reste distinct.
          </Notice>
        </Card>
      </div>
      <Card className="mt-5 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 sm:px-6">
          <div>
            <h2 className="font-semibold">Dernières commandes</h2>
            <p className="text-sm text-muted-foreground">Commandes enregistrées dans cette boutique</p>
          </div>
          <Button variant="ghost" onClick={() => navigate("orders")}>
            Tout voir
            <ArrowRight />
          </Button>
        </div>
        <OrdersTable orders={latest.data?.items || []} compact />
      </Card>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="font-semibold">Votre équipe</h2>
          <p className="text-sm text-muted-foreground">
            <span className="num">{f(active)}</span> membre{active > 1 ? "s" : ""} actif{active > 1 ? "s" : ""} dans cet espace.
          </p>
          <div>
            <Button variant="outline" onClick={() => navigate("team")}>
              <Users />
              Gérer les accès
            </Button>
          </div>
        </Card>
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="font-semibold">Vos commandes par message</h2>
          <p className="text-sm text-muted-foreground">
            Enregistrez aussi les commandes reçues sur WhatsApp, Messenger, Instagram ou par téléphone. Leur canal est conservé dans chaque fiche.
          </p>
          <div>
            <Button variant="outline" onClick={ui.newOrder}>
              <Plus />
              Ajouter une commande
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}
