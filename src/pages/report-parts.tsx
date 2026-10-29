import { useState, type ReactNode } from "react"
import { AlertTriangle, ArrowRight, Clock, Coins, PackageCheck, PhoneCall, ShoppingBag, Truck } from "lucide-react"
import { REPORT_MARKS, deliveryRate, minutesLabel, reportAlerts, reportRate, sortWilayas } from "@domain/report-domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/app/page"
import { f, money } from "@/lib/format"
import { cn } from "@/lib/utils"

export type Row = Record<string, any>
export type Insights = {
  funnel: Row
  reasons: Row[]
  wilayas: Row[]
  agents: Row[]
  speed: Row
  basket: Row
  delivery_days: number | null
  hours: { hour: number; orders: number }[]
}

export function Kpi({ label, value, foot, icon: Icon, onClick }: { label: string; value: string; foot: ReactNode; icon: typeof Coins; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn("grid min-w-0 content-start gap-1 bg-card p-5 text-left", onClick && "outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span>
      <span className="num text-[1.75rem] font-semibold tracking-tight">{value}</span>
      <span className="text-[0.8125rem] leading-snug text-muted-foreground">{foot}</span>
    </Tag>
  )
}

export function Section({ title, description, children, className, action }: { title: string; description?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

export function DataTable({ head, rows, empty, right = [] }: { head: string[]; rows: ReactNode[][]; empty: string; right?: number[] }) {
  if (!rows.length) return <EmptyState title="Aucune donnée pour ce filtre" description={empty} />
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {head.map((h, i) => <TableHead key={h} className={right.includes(i) ? "text-right" : undefined}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((c, j) => <TableCell key={j} className={cn(j === 0 ? "font-medium" : "num", right.includes(j) && "text-right")}>{c}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** A rate with its base, and a plain-word flag when it sits under the market reference point. */
function Rate({ n, base, mark, label }: { n: number; base: number; mark: number; label: string }) {
  const low = base >= REPORT_MARKS.wilayaMinParcels && (100 * n) / base < mark
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", low && "font-semibold text-danger")} title={low ? label + " sous le repère de " + mark + " %" : undefined}>
      {reportRate(n, base)}
      {low && <span className="text-xs font-medium">bas</span>}
    </span>
  )
}

const STEP_ICONS = [ShoppingBag, PhoneCall, Truck, PackageCheck]

/** Received → confirmed → shipped → delivered, then what happened to the shipped parcels. */
export function Journey({ x }: { x: Insights }) {
  const fu = x.funnel || {}
  const received = Number(fu.received || 0), base = Number(fu.rate_base || 0), confirmed = Number(fu.confirmed || 0)
  const shipped = Number(fu.shipped || 0), delivered = Number(fu.delivered || 0), returned = Number(fu.returned || 0), moving = Number(fu.in_progress || 0)
  const done = delivered + returned
  const steps: [string, number, string][] = [
    ["Reçues", received, "commandes créées dans la période"],
    ["Confirmées", confirmed, reportRate(confirmed, base) + " des commandes reçues"],
    ["Expédiées", shipped, reportRate(shipped, confirmed) + " des confirmées remises à ZR"],
    ["Livrées", delivered, done ? deliveryRate(delivered, returned) + " des colis arrivés au bout" : "aucun colis arrivé au bout"],
  ]
  const bar = shipped ? [["bg-success", delivered, "Livrées"], ["bg-danger", returned, "Retournées"], ["bg-chart-1", moving, "En route"]] as const : []
  return (
    <Card className="gap-5 p-5 sm:p-6">
      <div>
        <h2 className="font-semibold">Le parcours de vos commandes</h2>
        <p className="text-sm text-muted-foreground">De la commande reçue au colis livré, pour les commandes créées pendant la période.</p>
      </div>
      <ol className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {steps.map(([label, n, foot], i) => {
          const Icon = STEP_ICONS[i]
          return (
            <li key={label} className="relative grid gap-1 rounded-lg border bg-card p-4">
              <span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{i + 1}. {label}</span>
              <span className="num text-2xl font-semibold tracking-tight">{f(n)}</span>
              <span className="text-[0.8125rem] leading-snug text-muted-foreground">{foot}</span>
              {i < steps.length - 1 && <ArrowRight className="absolute top-1/2 -right-3 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-background p-0.5 text-muted-foreground xl:block" aria-hidden />}
            </li>
          )
        })}
      </ol>
      {shipped > 0 && (
        <div className="grid gap-2">
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Colis expédiés : ${f(delivered)} livrés, ${f(returned)} retournés, ${f(moving)} en route`}>
            {bar.map(([cls, n, label]) => n > 0 && <i key={label} className={cn("h-full", cls)} style={{ width: (100 * n) / shipped + "%" }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {bar.map(([cls, n, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5"><i className={cn("size-2 rounded-full", cls)} aria-hidden />{label} <b className="num text-foreground">{f(n)}</b></span>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p className="rounded-lg bg-muted px-3.5 py-3">
          <b className="num">{f(fu.lost)}</b> perdues avant l’expédition (annulées, faux numéros, doublons) · <b className="num">{f(fu.pending)}</b> encore à traiter par l’équipe.
        </p>
        <p className={cn("rounded-lg px-3.5 py-3", moving ? "bg-info-soft text-info" : "bg-muted")}>
          {moving
            ? <><b className="num">{f(moving)}</b> colis encore en route : le taux de livraison est provisoire et peut encore changer.</>
            : shipped ? "Tous les colis expédiés ont un résultat : le taux de livraison est définitif." : "Aucun colis expédié pour ces commandes."}
        </p>
      </div>
    </Card>
  )
}

export function Alerts({ x }: { x: Insights }) {
  const list = reportAlerts(x)
  if (!list.length) return null
  return (
    <section aria-labelledby="alerts-title" className="grid gap-2">
      <h2 id="alerts-title" className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warning" aria-hidden />À surveiller</h2>
      <ul className="grid gap-2 lg:grid-cols-2">
        {list.map((a) => (
          <li key={a.key} className={cn("rounded-lg px-4 py-3 text-sm", a.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
            <p className="font-semibold">{a.title}</p>
            <p className="mt-0.5 opacity-90">{a.detail}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Repères habituels du COD en Algérie, pas des objectifs propres à votre boutique.</p>
    </section>
  )
}

const LOST: Record<string, string> = { cancelled: "Annulée", fake: "Faux numéro", duplicate: "Doublon" }

export function LostReasons({ x }: { x: Insights }) {
  const total = (x.reasons || []).reduce((s, r) => s + Number(r.orders || 0), 0)
  return (
    <Section title="Pourquoi des commandes sont perdues" description="Motif saisi par l’équipe lors de l’annulation, du faux numéro ou du doublon.">
      <DataTable
        head={["Motif", "Décision", "Commandes", "Part des pertes"]}
        right={[2, 3]}
        empty="Aucune commande perdue sur cette période."
        rows={(x.reasons || []).map((r) => [r.reason || <span className="text-muted-foreground">Sans motif</span>, LOST[r.status] || r.status, f(r.orders), reportRate(r.orders, total)])}
      />
    </Section>
  )
}

export function Wilayas({ x }: { x: Insights }) {
  const [mode, setMode] = useState("orders")
  const [all, setAll] = useState(false)
  const rows = sortWilayas(x.wilayas || [], mode)
  const shown = all ? rows : rows.slice(0, 10)
  return (
    <Section
      title="Wilayas : confirmation, livraison et retours"
      description={`${f(rows.length)} wilaya${rows.length > 1 ? "s" : ""} avec des commandes · taux de livraison = livrées ÷ colis arrivés au bout`}
      action={
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Trier
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Trier les wilayas" className="w-auto">
            <NativeSelectOption value="orders">Plus de commandes</NativeSelectOption>
            <NativeSelectOption value="returns">Plus de retours</NativeSelectOption>
          </NativeSelect>
        </label>
      }
    >
      <DataTable
        head={["Wilaya", "Commandes", "Confirmation", "Livrées", "Retournées", "Taux de livraison", "Délai moyen", "COD livré"]}
        right={[1, 2, 3, 4, 5, 6, 7]}
        empty="Aucune wilaya dans cette sélection."
        rows={shown.map((w) => {
          const done = Number(w.delivered || 0) + Number(w.returned || 0)
          return [
            w.wilaya,
            f(w.orders),
            reportRate(w.confirmed, w.rate_base),
            f(w.delivered),
            f(w.returned),
            done ? <Rate n={Number(w.delivered)} base={done} mark={REPORT_MARKS.delivery} label="Livraison" /> : "—",
            w.avg_days === null || w.avg_days === undefined ? "—" : String(w.avg_days).replace(".", ",") + " j",
            money(w.delivered_cod),
          ]
        })}
      />
      {rows.length > 10 && (
        <div className="border-t px-4 py-3 sm:px-6">
          <Button variant="outline" size="sm" onClick={() => setAll((v) => !v)}>{all ? "Afficher les 10 premières" : `Afficher les ${f(rows.length)} wilayas`}</Button>
        </div>
      )}
    </Section>
  )
}

export function Agents({ x }: { x: Insights }) {
  return (
    <Section title="Agents : rapidité et qualité" description="Une bonne confirmation se voit à la livraison : un agent qui confirme beaucoup mais dont les colis reviennent doit être accompagné.">
      <DataTable
        head={["Agent actuel", "Commandes", "Confirmation", "Livraison de ses confirmées", "Premier appel", "Appels sans réponse"]}
        right={[1, 2, 3, 4, 5]}
        empty="Aucune attribution dans cette sélection."
        rows={(x.agents || []).map((a) => {
          const done = Number(a.delivered || 0) + Number(a.returned || 0)
          return [
            a.name,
            f(a.orders),
            <Rate n={Number(a.confirmed)} base={Number(a.rate_base)} mark={REPORT_MARKS.confirmation} label="Confirmation" />,
            done ? <><Rate n={Number(a.delivered)} base={done} mark={REPORT_MARKS.delivery} label="Livraison" /><span className="block text-xs text-muted-foreground">sur {f(done)} colis</span></> : "—",
            <span className={cn(Number(a.median_first_minutes) > REPORT_MARKS.firstCallMinutes && "font-semibold text-warning")}>{minutesLabel(a.median_first_minutes)}</span>,
            a.avg_no_answer === null || a.avg_no_answer === undefined ? "—" : String(a.avg_no_answer).replace(".", ",") + " / commande",
          ]
        })}
      />
      <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
        Premier appel : temps médian entre l’arrivée de la commande et la première action de l’équipe (appel, rappel ou décision).
      </p>
    </Section>
  )
}

export function BasketAndHours({ x }: { x: Insights }) {
  const b = x.basket || {}
  const sp = x.speed || {}
  const hours = x.hours || []
  const max = Math.max(1, ...hours.map((h) => Number(h.orders) || 0))
  const peak = hours.reduce((p, h) => (Number(h.orders) > Number(p.orders) ? h : p), { hour: -1, orders: 0 })
  const stats: [string, string, string][] = [
    ["Panier moyen", b.avg_total === null || b.avg_total === undefined ? "—" : money(b.avg_total), "commandes confirmées, frais compris"],
    ["Articles par commande", b.avg_units === null || b.avg_units === undefined ? "—" : String(b.avg_units).replace(".", ","), reportRate(b.multi_unit, b.orders) + " avec plusieurs articles"],
    ["Premier appel", minutesLabel(sp.median_first_minutes), reportRate(sp.within_30, sp.handled) + " traitées en 30 min ou moins"],
    ["Délai de livraison", x.delivery_days === null || x.delivery_days === undefined ? "—" : String(x.delivery_days).replace(".", ",") + " j", "médiane entre la remise à ZR et la livraison"],
  ]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
      <Card className="grid gap-px overflow-hidden bg-border py-0 sm:grid-cols-2">
        {stats.map(([label, value, foot], i) => (
          <Kpi key={label} label={label} value={value} foot={foot} icon={[Coins, ShoppingBag, Clock, Truck][i]} />
        ))}
      </Card>
      <Card className="gap-3 p-5 sm:p-6">
        <div>
          <h2 className="font-semibold">Heures des commandes</h2>
          <p className="text-sm text-muted-foreground">{peak.hour >= 0 && peak.orders > 0 ? `Pic entre ${peak.hour} h et ${peak.hour + 1} h : prévoyez l’équipe d’appel juste après.` : "Aucune commande sur cette période."}</p>
        </div>
        <div
          role="img"
          aria-label={"Commandes par heure, heure d’Alger : " + hours.map((h) => `${h.hour} h : ${h.orders}`).join(", ")}
          className="grid h-32 grid-cols-24 items-end gap-0.5 border-b"
        >
          {hours.map((h) => (
            <i key={h.hour} className={cn("rounded-t-sm", h.hour === peak.hour && peak.orders > 0 ? "bg-chart-1" : "bg-chart-2/60")} style={{ height: h.orders ? Math.max(4, (100 * h.orders) / max) + "%" : "0" }} />
          ))}
        </div>
        <div className="grid grid-cols-24 text-xs text-muted-foreground" aria-hidden>
          {hours.map((h) => <span key={h.hour} className="num text-center">{h.hour % 6 === 0 ? h.hour + "h" : ""}</span>)}
        </div>
      </Card>
    </div>
  )
}
