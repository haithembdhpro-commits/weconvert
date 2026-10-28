import { useState, type ReactNode } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { BadgeCheck, Coins, Download, Filter, Plus, ShoppingBag, Trash2, Truck, Undo2 } from "lucide-react"
import { CHANNELS, csvCell, requestId } from "@domain/domain.mjs"
import { algerToday, reportBuckets, reportRange, reportRate } from "@domain/report-domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, FormError, FormField, Notice, PageHeader, Pager } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { type Tone } from "@/components/app/tone"
import { useOrderUI } from "@/components/app/orders"
import { useSubmit } from "@/components/app/useSubmit"
import { rpc, safeError, select } from "@/lib/api"
import { f, money } from "@/lib/format"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { ZrBadge } from "./Shipping"

type Row = Record<string, any>
type Report = { period: { from: string; to: string }; summary: Row; days: Row[]; channels: Row[]; wilayas: Row[]; products: Row[]; agents: Row[] }
type Filters = { preset: string; from: string; to: string; channel: string; agent: string }

const shortDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-DZ", { day: "numeric", month: "short" })
const PRESETS: [string, string][] = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["365", "12 mois"]]

function range(fl: Filters) {
  return fl.preset === "custom" ? { from: fl.from, to: fl.to } : reportRange(fl.preset)
}

function validate(from: string, to: string) {
  const today = algerToday()
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z")
  const ok =
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && Number.isFinite(a) && Number.isFinite(b) &&
    new Date(a).toISOString().slice(0, 10) === from && new Date(b).toISOString().slice(0, 10) === to &&
    from >= "2000-01-01" && to <= today && from <= to && (b - a) / 86400000 <= 365
  if (!ok) throw Error("INVALID_FILTER")
}

function Kpi({ label, value, foot, icon: Icon, onClick }: { label: string; value: string; foot: ReactNode; icon: typeof Coins; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn("grid min-w-0 gap-1 bg-card p-5 text-left", onClick && "outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span>
      <span className="num text-[1.75rem] font-semibold tracking-tight">{value}</span>
      <span className="text-[0.8125rem] leading-snug text-muted-foreground">{foot}</span>
    </Tag>
  )
}

function DataTable({ head, rows, empty, right = [] }: { head: string[]; rows: ReactNode[][]; empty: string; right?: number[] }) {
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

function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="border-b p-4 sm:px-6">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </Card>
  )
}

function Chart({ days }: { days: Row[] }) {
  const buckets = reportBuckets(days as any)
  const max = Math.max(1, ...buckets.map((b) => b.orders))
  if (!buckets.some((b) => b.orders)) return <EmptyState title="Aucune commande sur cette période" description="Essayez une autre plage de dates ou un autre canal." />
  const step = buckets.length > 20 ? 5 : buckets.length > 12 ? 2 : 1
  const label = (b: (typeof buckets)[number]) => (b.from === b.to ? shortDate(b.from) : shortDate(b.from) + " – " + shortDate(b.to))
  return (
    <>
      <div role="region" aria-label="Évolution des commandes ; défilement horizontal si nécessaire" tabIndex={0} className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex h-56 min-w-full items-stretch gap-1.5 border-b" style={{ width: Math.max(buckets.length * 28, 0) }}>
          {buckets.map((b, i) => (
            <div key={b.key} role="img" tabIndex={0} title={`${label(b)} : ${f(b.orders)} reçues, ${f(b.confirmed)} confirmées, ${f(b.cancelled)} annulées`} aria-label={`${label(b)} : ${f(b.orders)} reçues, ${f(b.confirmed)} confirmées, ${f(b.cancelled)} annulées`} className="relative flex flex-1 flex-col justify-end pb-6 outline-none focus-visible:bg-accent">
              <div className="flex h-full items-end justify-center gap-0.5" aria-hidden>
                <i className="w-1/2 max-w-4 rounded-t-sm bg-chart-2" style={{ height: `${b.orders ? Math.max(2, (100 * b.orders) / max) : 0}%` }} />
                <i className="w-1/2 max-w-4 rounded-t-sm bg-chart-1" style={{ height: `${b.confirmed ? Math.max(2, (100 * b.confirmed) / max) : 0}%` }} />
              </div>
              <small className="num absolute bottom-0 left-1/2 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-muted-foreground">{i % step === 0 || i === buckets.length - 1 ? shortDate(b.from) : ""}</small>
            </div>
          ))}
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer py-2 text-primary">Voir les valeurs détaillées du graphique</summary>
        <DataTable head={["Période", "Reçues", "Confirmées", "Annulées"]} right={[1, 2, 3]} rows={buckets.map((b) => [label(b), f(b.orders), f(b.confirmed), f(b.cancelled)])} empty="" />
      </details>
    </>
  )
}

const BAR: Record<Tone, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-neutral", info: "bg-info", violet: "bg-violet" }

function StatusBars({ s }: { s: Row }) {
  const items: [string, number, Tone][] = [["Confirmées", s.confirmed, "success"], ["À traiter", s.pending, "warning"], ["Annulées", s.cancelled, "danger"], ["Doublons", s.duplicate, "neutral"], ["Faux numéros", s.fake, "neutral"]]
  return (
    <ul className="grid gap-4">
      {items.map(([label, n, tone]) => (
        <li key={label}>
          <div className="flex justify-between text-sm"><b className="font-medium">{label}</b><span className="num text-muted-foreground">{f(n)} · {reportRate(n, s.orders)}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <i className={cn("block h-full rounded-full", BAR[tone])} style={{ width: `${s.orders ? Math.min(100, (100 * Number(n)) / Number(s.orders)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Performance() {
  const s = useSession()
  const qc = useQueryClient()
  const ui = useOrderUI()
  const [fl, setFl] = useState<Filters>({ preset: "30", from: "", to: "", channel: "", agent: "" })
  const [filterError, setFilterError] = useState("")
  const [deliveredPage, setDeliveredPage] = useState(1)
  const [delExpense, setDelExpense] = useState<Row | null>(null)
  const expenseSub = useSubmit()
  const delSub = useSubmit()
  const [expenseKey, setExpenseKey] = useState(() => requestId())
  const p = range(fl)
  const agent = s.manager ? fl.agent || null : null
  const channel = fl.channel || null
  const base = ["store", s.store, "perf", p.from, p.to, channel, agent] as const

  const report = useQuery({
    queryKey: [...base, "report"],
    enabled: !!s.store,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Report>("crm_performance", { p_store: s.store, p_from: p.from, p_to: p.to, p_agent: agent, p_channel: channel }),
  })
  const delivery = useQuery({
    queryKey: [...base, "delivery"],
    enabled: !!s.store && s.manager,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ summary: Row; channels: Row[] }>("crm_delivery_performance", { p_store: s.store, p_from: p.from, p_to: p.to, p_channel: channel }),
  })
  const delivered = useQuery({
    queryKey: [...base, "delivered", deliveredPage],
    enabled: !!s.store && s.manager,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ orders: Row[]; total: number }>("crm_delivered_period_page", { p_store: s.store, p_from: p.from, p_to: p.to, p_agent: agent, p_channel: channel, p_page: deliveredPage }),
  })
  const expenses = useQuery({
    queryKey: ["store", s.store, "perf", p.from, p.to, "expenses"],
    enabled: !!s.store && s.manager,
    queryFn: async () =>
      (await select<Row[]>(supabase.from("crm_cost_entries").select("id,spent_on,kind,amount,note").eq("store_id", s.store!).gte("spent_on", p.from).lte("spent_on", p.to).order("spent_on", { ascending: false }).limit(100))).data,
  })

  const r = report.data
  const sm = r?.summary || {}
  const label = r ? `${shortDate(r.period.from)} – ${shortDate(r.period.to)}` : ""
  const today = algerToday()

  function setPreset(id: string) {
    setFilterError("")
    setDeliveredPage(1)
    setFl((x) => ({ ...x, preset: id }))
  }

  function exportCsv() {
    if (!r) return
    const x = r.summary
    const sections: unknown[][] = [
      ["WeConvert · Performance & rapports"], ["Boutique", s.storeName], ["Du", r.period.from], ["Au", r.period.to], ["Fuseau horaire", "Africa/Algiers"],
      ["Filtre canal", fl.channel ? CHANNELS[fl.channel] : "Tous"], ["Filtre agent", fl.agent ? s.memberName(fl.agent) : s.manager ? "Tous" : "Mes commandes"], [],
      ["Indicateurs", "Valeur"], ["Commandes reçues", x.orders], ["Confirmées", x.confirmed], ["À traiter", x.pending], ["Annulées", x.cancelled], ["Doublons", x.duplicate], ["Faux numéros", x.fake],
      ["Taux de confirmation", reportRate(x.confirmed, x.orders)], ["Montant COD confirmé (DA)", x.confirmed_amount],
      ["WooCommerce dans le rapport opérationnel", x.woo_orders], ["WooCommerce avec Purchase CAPI marqué envoyé", x.woo_purchase_marked], ["WooCommerce sans preuve de suivi", x.woo_unverified],
      ["Confirmations Woo historiques non vérifiées", x.woo_confirmation_unverified], ["Annulations Woo historiques non vérifiées", x.woo_cancellation_unverified],
      ...(s.manager ? [["Commandes créées dans la période et actuellement livrées (ZR)", delivered.data?.total ?? 0]] : []), [],
      ["Évolution", "Reçues", "Confirmées", "Annulées"], ...(r.days || []).map((d) => [d.date, d.orders, d.confirmed, d.cancelled]), [],
      ["Canal", "Reçues", "Confirmées", "Annulées", "Montant COD confirmé (DA)"], ...(r.channels || []).map((d) => [CHANNELS[d.channel] || d.channel, d.orders, d.confirmed, d.cancelled, d.confirmed_amount]), [],
      ["Wilaya", "Reçues", "Confirmées", "Montant COD confirmé (DA)"], ...(r.wilayas || []).map((d) => [d.wilaya, d.orders, d.confirmed, d.confirmed_amount]), [],
      ["Produit", "SKU", "Unités", "Unités confirmées", "Montant des lignes confirmées (DA)"], ...(r.products || []).map((d) => [d.name, d.sku, d.units, d.confirmed_units, d.confirmed_lines_amount]), [],
      ["Agent actuel", "Reçues", "Confirmées", "Annulées", "Montant COD confirmé (DA)"], ...(r.agents || []).map((d) => [d.name, d.orders, d.confirmed, d.cancelled, d.confirmed_amount]),
    ]
    const csv = "﻿" + sections.map((row) => (row as unknown[]).map(csvCell).join(";")).join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `WeConvert-performance-${r.period.from}-${r.period.to}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success("Rapport CSV exporté pour la période sélectionnée.")
  }

  const scrollToDelivered = () => {
    const el = document.getElementById("delivered-period-title")
    el?.scrollIntoView({ block: "start", behavior: "smooth" })
    el?.focus({ preventScroll: true })
  }

  const legacy = (Number(sm.woo_confirmation_unverified) || 0) + (Number(sm.woo_cancellation_unverified) || 0)
  const d = delivery.data?.summary || {}
  const missing = Number(d.missing_product_cost || 0) + Number(d.missing_shipping_cost || 0)

  return (
    <>
      <PageHeader
        title="Performance & rapports."
        description="L’activité réelle de vos commandes COD, de la réception à la livraison."
        actions={r && <Button variant="outline" onClick={exportCsv}><Download />Exporter le rapport CSV</Button>}
      />
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Filtres du rapport</h2>
            <p className="text-sm text-muted-foreground">Période selon la création des commandes · états CRM et ZR actuels · heure d’Alger.</p>
          </div>
          <div role="group" aria-label="Périodes rapides" className="flex flex-wrap gap-1.5">
            {PRESETS.map(([id, l]) => (
              <Button key={id} size="sm" variant={fl.preset === id ? "default" : "outline"} aria-pressed={fl.preset === id} onClick={() => setPreset(id)}>{l}</Button>
            ))}
          </div>
        </div>
        <form
          key={fl.preset + p.from + p.to}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
            try {
              validate(v.from, v.to)
              if (v.channel && !Object.hasOwn(CHANNELS, v.channel)) throw Error("INVALID_FILTER")
              if (v.agent && (!s.manager || !s.members.some((m) => m.user_id === v.agent))) throw Error("INVALID_FILTER")
              setFilterError("")
              setDeliveredPage(1)
              setFl({ preset: "custom", from: v.from, to: v.to, channel: v.channel || "", agent: s.manager ? v.agent || "" : "" })
            } catch (err) {
              setFilterError(safeError(err))
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Du" htmlFor="pf-from" required><Input id="pf-from" name="from" type="date" defaultValue={p.from} min="2000-01-01" max={today} required /></FormField>
            <FormField label="Au (inclus)" htmlFor="pf-to" required><Input id="pf-to" name="to" type="date" defaultValue={p.to} min="2000-01-01" max={today} required /></FormField>
            <FormField label="Canal" htmlFor="pf-channel">
              <NativeSelect id="pf-channel" name="channel" defaultValue={fl.channel}>
                <NativeSelectOption value="">Tous les canaux</NativeSelectOption>
                {Object.entries(CHANNELS).map(([k, v]) => <NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}
              </NativeSelect>
            </FormField>
            {s.manager && (
              <FormField label="Agent" htmlFor="pf-agent">
                <NativeSelect id="pf-agent" name="agent" defaultValue={fl.agent}>
                  <NativeSelectOption value="">Tous les agents</NativeSelectOption>
                  {s.members.map((m) => <NativeSelectOption key={m.user_id} value={m.user_id}>{m.display_name + (m.active ? "" : " · inactif")}</NativeSelectOption>)}
                </NativeSelect>
              </FormField>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit"><Filter />Appliquer les filtres</Button>
            <span className="text-xs text-muted-foreground">Jusqu’à 366 jours par rapport · données de la boutique sélectionnée.</span>
          </div>
          <FormError message={filterError} />
        </form>
      </Card>

      {report.isError ? (
        <Notice tone="danger" role="alert" className="mt-5">{safeError(report.error)}</Notice>
      ) : !r ? null : (
        <>
          <Card className={cn("mt-5 grid gap-px overflow-hidden bg-border py-0", s.manager ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
            <Kpi label="Commandes reçues" value={f(sm.orders)} foot={"Créées du " + label} icon={ShoppingBag} />
            <Kpi label="Taux de confirmation" value={reportRate(sm.confirmed, sm.orders)} foot={`${f(sm.confirmed)} confirmées ÷ ${f(sm.orders)} reçues`} icon={BadgeCheck} />
            <Kpi label="Montant COD confirmé" value={money(sm.confirmed_amount)} foot="Promis à la livraison · non encaissé" icon={Coins} />
            {s.manager && <Kpi label="Commandes livrées" value={f(delivered.data?.total)} foot={"Créées du " + label + " · statut ZR actuel · voir la liste"} icon={Truck} onClick={scrollToDelivered} />}
          </Card>
          {legacy > 0 && (
            <Notice tone="warning" className="mt-4">
              {f(legacy)} commandes historiques portent un statut « confirmé » ou « annulé » issu de WooCommerce sans décision COD vérifiée. Elles restent consultables, mais sont exclues des confirmations, annulations et montants de ce rapport.
            </Notice>
          )}
          {Number(sm.woo_orders) > 0 && (
            <Notice className="mt-4">
              Suivi WooCommerce : {f(sm.woo_purchase_marked)} sur {f(sm.woo_orders)} commandes de la période ont un Purchase CAPI marqué envoyé par la Suite WeConvert. {f(sm.woo_unverified)} restent sans preuve et sont incluses dans ces chiffres opérationnels ; elles ne doivent pas être comparées directement aux achats Meta.
            </Notice>
          )}

          {s.manager && (
            <Card className="mt-5 gap-0 overflow-hidden py-0">
              <div className="border-b p-4 sm:px-6">
                <h2 id="delivered-period-title" tabIndex={-1} className="scroll-mt-20 font-semibold outline-none">Commandes de la période livrées</h2>
                <p className="text-sm text-muted-foreground">{f(delivered.data?.total)} commande(s) créée(s) pendant la période · statut ZR actuel « Livré »</p>
              </div>
              <DataTable
                head={["Commande", "Client", "Canal", "Commande créée le", "COD demandé", "Statut ZR"]}
                right={[4]}
                empty="Essayez une autre plage de dates ou un autre canal."
                rows={(delivered.data?.orders || []).map((o) => [
                  <button type="button" className="num font-semibold text-primary hover:underline" onClick={() => ui.openOrder(o.order_id)}>#WC{String(o.number).padStart(5, "0")}{o.woo_number && <span className="block text-xs font-normal text-muted-foreground">Woo #{o.woo_number}</span>}</button>,
                  <>{o.customer_name}<span className="block text-xs text-muted-foreground">{o.wilaya}</span></>,
                  CHANNELS[o.channel] || o.channel,
                  new Date(o.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "medium", timeStyle: "short" }),
                  money(o.cod_amount),
                  <ZrBadge state={o.state} />,
                ])}
              />
              <Pager total={Number(delivered.data?.total || 0)} page={deliveredPage} onPage={(n) => setDeliveredPage(Math.max(1, n))} />
            </Card>
          )}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="gap-0 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Évolution des commandes</h2>
                  <p className="text-sm text-muted-foreground">Jour de création · statut actuel de chaque commande</p>
                </div>
                <span className="num rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{label}</span>
              </div>
              <div className="mt-3 mb-4 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-chart-2" aria-hidden />Reçues</span>
                <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-chart-1" aria-hidden />Confirmées</span>
              </div>
              <Chart days={r.days || []} />
            </Card>
            <Card className="gap-4 p-5 sm:p-6">
              <div>
                <h2 className="font-semibold">Répartition des statuts</h2>
                <p className="text-sm text-muted-foreground">Sur {f(sm.orders)} commandes créées dans la période</p>
              </div>
              <StatusBars s={sm} />
              <p className="text-xs text-muted-foreground">Les confirmations et annulations historiques déduites de WooCommerce sont exclues. Les statuts affichés sont ceux d’aujourd’hui ; confirmé ne signifie pas livré.</p>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Section title="Par canal" description="Site web, WhatsApp, Messenger, Instagram, téléphone et saisie manuelle">
              <DataTable head={["Canal", "Reçues", "Confirmées", "Taux", "Montant COD confirmé"]} right={[1, 2, 3, 4]} empty="Les commandes par message apparaîtront selon leur canal de saisie."
                rows={(r.channels || []).map((x) => [CHANNELS[x.channel] || x.channel, f(x.orders), f(x.confirmed), reportRate(x.confirmed, x.orders), money(x.confirmed_amount)])} />
            </Section>
            <Section title="Par wilaya" description="Les 10 premières selon les commandes reçues">
              <DataTable head={["Wilaya", "Reçues", "Confirmées", "Taux"]} right={[1, 2, 3]} empty="Aucune wilaya dans cette sélection."
                rows={(r.wilayas || []).map((x) => [x.wilaya, f(x.orders), f(x.confirmed), reportRate(x.confirmed, x.orders)])} />
            </Section>
            <Section title="Par produit" description="Articles des commandes, variantes comprises · montant des lignes hors frais de livraison">
              <DataTable head={["Produit", "Unités commandées", "Unités confirmées", "Lignes confirmées"]} right={[1, 2, 3]} empty="Aucun produit dans cette sélection."
                rows={(r.products || []).map((x) => [<>{x.name}<span className="block text-xs font-normal text-muted-foreground">{x.sku}</span></>, f(x.units), f(x.confirmed_units), money(x.confirmed_lines_amount)])} />
            </Section>
            <Section title="Par agent" description="Affectation actuelle, commandes non attribuées incluses">
              <DataTable head={["Agent actuel", "Commandes", "Confirmées", "Taux", "Montant COD confirmé"]} right={[1, 2, 3, 4]} empty="Aucune attribution dans cette sélection."
                rows={(r.agents || []).map((x) => [x.name, f(x.orders), f(x.confirmed), reportRate(x.confirmed, x.orders), money(x.confirmed_amount)])} />
            </Section>
          </div>
          <Notice className="mt-4">
            Taux de confirmation = commandes confirmées dans le CRM et vérifiables ÷ commandes créées dans la période. Les anciens statuts déduits de WooCommerce sont exclus. Le montant COD confirmé n’est pas encaissé. « Livrées » compte ces mêmes commandes actuellement au statut livré chez ZR ; leur date réelle de livraison n’est pas connue pour les colis historiques.
          </Notice>

          {s.manager &&
            (fl.agent ? (
              <Card className="mt-5 gap-2 p-5 sm:p-6">
                <h2 className="font-semibold">Livraison & marge COD</h2>
                <p className="text-sm text-muted-foreground">Ce rapport de livraison est calculé pour toute la boutique. Choisissez « Tous les agents » pour voir des chiffres cohérents avec les filtres.</p>
              </Card>
            ) : (
              <section className="mt-5 grid gap-5">
                <Card className="gap-4 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Livraison & marge COD</h2>
                      <p className="text-sm text-muted-foreground">Commandes créées pendant la période sélectionnée · état ZR au dernier suivi</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={scrollToDelivered}>Voir les commandes livrées</Button>
                  </div>
                  <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
                    <Kpi label="Livrées · cohorte créée" value={f(d.delivered)} foot={`${f(d.shipped)} remis à ZR · ${reportRate(d.delivered, d.closed)} livrés sur colis terminés`} icon={Truck} />
                    <Kpi label="Retours ZR" value={f(d.returned)} foot={`${reportRate(d.returned, d.closed)} des colis terminés (livrés + retournés)`} icon={Undo2} />
                    <Kpi label="COD livré" value={money(d.delivered_cod)} foot="COD demandé · reversement non vérifié" icon={Coins} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-muted p-4">
                      <p className="text-xs text-muted-foreground">Marge après produits et frais ZR</p>
                      <p className="num mt-1 text-xl font-semibold">{d.contribution === null || d.contribution === undefined ? "—" : money(d.contribution)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        COD livré − coûts d’achat estimés des produits livrés − frais ZR de tous les colis rattachés.{" "}
                        {missing ? `Calcul bloqué : ${f(d.missing_product_cost)} colis livrés sans coût d’achat et ${f(d.missing_shipping_cost)} colis sans frais ZR.` : "Coûts renseignés sur les colis concernés."}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted p-4">
                      <p className="text-xs text-muted-foreground">Résultat après dépenses saisies</p>
                      <p className="num mt-1 text-xl font-semibold">{fl.channel || d.after_recorded_expenses === null || d.after_recorded_expenses === undefined ? "—" : money(d.after_recorded_expenses)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {fl.channel
                          ? "Les dépenses de la boutique ne sont pas réparties par canal. Affichez « Tous les canaux » pour ce résultat."
                          : `Publicité saisie : ${money(d.ads_recorded)} · exploitation saisie : ${money(d.operations_recorded)}. Les dépenses absentes ne valent pas zéro : ce résultat n’est pas un bénéfice net comptable.`}
                      </p>
                    </div>
                  </div>
                  <Notice>
                    Commandes WooCommerce dans ce rapport : {f(d.woo_delivered)} livrées sur {f(d.woo_orders)}. {f(d.delivery_issues)} colis sont en retour ou en échec. Le statut ZR « Livré » ne prouve pas le reversement.
                  </Notice>
                </Card>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Section title="Livraison par canal" description="La période suit la création des commandes, pas la date de livraison.">
                    <DataTable head={["Canal", "Reçues", "Expédiées", "Livrées", "Retournées", "COD livré"]} right={[1, 2, 3, 4, 5]} empty="Aucun colis rattaché pour ce filtre."
                      rows={(delivery.data?.channels || []).map((x) => [CHANNELS[x.channel] || x.channel, f(x.orders), f(x.shipped), f(x.delivered), f(x.returned), money(x.delivered_cod)])} />
                  </Section>
                  <Card className="gap-3 p-5 sm:p-6">
                    <h2 className="font-semibold">Ajouter une dépense</h2>
                    <p className="text-sm text-muted-foreground">Renseignez les dépenses réelles de publicité et d’exploitation pour compléter la marge.</p>
                    <form
                      key={expenseKey}
                      className="grid gap-4"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
                        expenseSub.run(async () => {
                          // One request id per draft: a retry after a network cut cannot record the expense twice.
                          await rpc("crm_cost_command", { p_store: s.store, p_action: "expense", p: { ...v, amount: Number(v.amount), request_id: expenseKey } })
                          toast.success("Coût enregistré.")
                          setExpenseKey(requestId())
                          await qc.invalidateQueries({ queryKey: ["store", s.store] })
                        })
                      }}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Date" htmlFor="ex-date" required><Input id="ex-date" name="spent_on" type="date" defaultValue={today} max={today} required /></FormField>
                        <FormField label="Type" htmlFor="ex-kind" required>
                          <NativeSelect id="ex-kind" name="kind" defaultValue="ads"><NativeSelectOption value="ads">Publicité</NativeSelectOption><NativeSelectOption value="operations">Exploitation</NativeSelectOption></NativeSelect>
                        </FormField>
                        <FormField label="Montant (DA)" htmlFor="ex-amount" required><Input id="ex-amount" name="amount" type="number" min={0} step={0.01} required className="num" /></FormField>
                        <FormField label="Description" htmlFor="ex-note"><Input id="ex-note" name="note" maxLength={160} /></FormField>
                      </div>
                      <FormError message={expenseSub.error} />
                      <div><Button type="submit" disabled={expenseSub.busy}><Plus />Enregistrer la dépense</Button></div>
                    </form>
                  </Card>
                </div>
                <Section title="Dépenses enregistrées" description={`${f((expenses.data || []).length)} affichées pour la période · maximum 100 lignes${fl.channel ? " · tous les canaux de la boutique" : ""}`}>
                  <DataTable
                    head={["Date", "Type", "Description", "Montant", "Action"]}
                    right={[3]}
                    empty="Le résultat après dépenses reste partiel tant que les frais ne sont pas saisis."
                    rows={(expenses.data || []).map((x) => [
                      x.spent_on,
                      x.kind === "ads" ? "Publicité" : "Exploitation",
                      x.note || "—",
                      money(x.amount),
                      <Button variant="outline" size="sm" onClick={() => setDelExpense(x)} aria-label={"Supprimer la dépense du " + x.spent_on}><Trash2 />Supprimer</Button>,
                    ])}
                  />
                </Section>
              </section>
            ))}
        </>
      )}

      {delExpense && (
        <FormDialog
          id="expense-delete-form"
          title="Supprimer cette dépense ?"
          description={<>La dépense du {delExpense.spent_on} de <b>{money(delExpense.amount)}</b> sera retirée des calculs. Cette action est définitive.</>}
          submitLabel="Supprimer"
          busy={delSub.busy}
          error={delSub.error}
          onClose={() => { setDelExpense(null); delSub.reset() }}
          onSubmit={() =>
            delSub.run(async () => {
              await rpc("crm_cost_command", { p_store: s.store, p_action: "delete_expense", p: { id: delExpense.id } })
              setDelExpense(null)
              toast.success("Dépense supprimée.")
              await qc.invalidateQueries({ queryKey: ["store", s.store] })
            })
          }
        >
          <span className="sr-only">Confirmation</span>
        </FormDialog>
      )}
    </>
  )
}
