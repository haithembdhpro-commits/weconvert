import { useId } from "react"
import { cn } from "@/lib/utils"

/*
 * Dot-matrix charts (style requested 28/10/2026). Pure SVG, no chart library.
 * Colours come from currentColor / CSS tokens, so blue and orange accents, light and dark themes all work.
 * Every chart carries a text alternative (aria-label) — colour never carries meaning alone.
 */

const GAP = 10 // distance between dot centres in viewBox units
const R = 3

function filled(v: number, max: number, rows: number) {
  if (!(v > 0) || !(max > 0)) return 0
  return Math.min(rows, Math.max(1, Math.round((v / max) * rows)))
}

/** Small column sparkline: each value is a block of dot columns (denser when there are few values), filled from the bottom. */
export function DotSpark({ values, label, className, rows = 7 }: { values: number[]; label: string; className?: string; rows?: number }) {
  const max = Math.max(0, ...values)
  const k = Math.max(1, Math.floor(16 / Math.max(1, values.length)))
  const step = (k + (k > 1 ? 1 : 0)) * GAP
  const w = Math.max(GAP, values.length * step - (k > 1 ? GAP : 0))
  const h = rows * GAP
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className={cn("h-14 w-32 shrink-0", className)} preserveAspectRatio="xMaxYMax meet">
      {values.map((v, c) => {
        const n = filled(v, max, rows)
        return Array.from({ length: rows * k }, (_, i) => {
          const r = Math.floor(i / k)
          return (
            <circle key={c + "-" + i} cx={c * step + (i % k) * GAP + GAP / 2} cy={h - r * GAP - GAP / 2} r={R} className={r < n ? "fill-current" : "fill-muted-foreground/15"} />
          )
        })
      })}
    </svg>
  )
}

export type DotDay = { date: string; orders: number; confirmed: number; cancelled: number }

const shortDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })

/**
 * Daily activity as a dense dot matrix: each day is a block of `k` dot columns (k shrinks as the period grows),
 * each dot = `unit` orders, filled bottom-up: confirmed (green), cancelled (red), still to process (accent).
 * Today is marked with a dashed line. Circles keep their shape (no aspect stretching).
 */
export function DotStack({ days, rows = 10 }: { days: DotDay[]; rows?: number }) {
  const id = useId()
  const k = Math.max(1, Math.floor(36 / Math.max(1, days.length)))
  const capacity = k * rows
  const max = Math.max(0, ...days.map((d) => Number(d.orders) || 0))
  const unit = Math.max(1, Math.ceil(max / capacity))
  const step = (k + 1) * GAP
  const w = Math.max(GAP, days.length * step - GAP)
  const h = rows * GAP + 6
  const every = days.length > 20 ? 7 : days.length > 10 ? 3 : 1
  const summary = days
    .map((d) => `${shortDay(d.date)} : ${d.orders} reçues, ${d.confirmed} confirmées, ${d.cancelled} annulées`)
    .join(" ; ")
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-labelledby={id} className="h-auto max-h-64 w-full" preserveAspectRatio="xMidYMax meet">
        <title id={id}>{"Activité quotidienne. " + summary}</title>
        {days.map((d, c) => {
          const total = filled(Number(d.orders) || 0, unit * capacity, capacity)
          const conf = Math.min(total, Math.round((Number(d.confirmed) || 0) / unit))
          const canc = Math.min(total - conf, Math.round((Number(d.cancelled) || 0) / unit))
          const x0 = c * step
          const today = c === days.length - 1
          return (
            <g key={d.date}>
              <title>{`${shortDay(d.date)} : ${d.orders} reçues · ${d.confirmed} confirmées · ${d.cancelled} annulées`}</title>
              {today && <line x1={x0 + (k * GAP) / 2} x2={x0 + (k * GAP) / 2} y1={0} y2={h} className="stroke-foreground/40" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
              {Array.from({ length: capacity }, (_, i) => {
                const r = Math.floor(i / k)
                const col = i % k
                const cls = i < conf ? "fill-success" : i < conf + canc ? "fill-danger" : i < total ? "fill-chart-1" : "fill-muted-foreground/12"
                return <circle key={i} cx={x0 + col * GAP + GAP / 2} cy={h - r * GAP - GAP / 2} r={R} className={cls} />
              })}
            </g>
          )
        })}
      </svg>
      <div className="relative h-4 text-xs text-muted-foreground" aria-hidden>
        {days.map((d, c) =>
          c % every === 0 || c === days.length - 1 ? (
            <span
              key={d.date}
              className={cn("num absolute -translate-x-1/2 whitespace-nowrap", c === days.length - 1 && "font-semibold text-foreground")}
              style={{ left: `${((c * step + (k * GAP) / 2) / w) * 100}%` }}
            >
              {c === days.length - 1 ? "Aujourd’hui" : shortDay(d.date)}
            </span>
          ) : null,
        )}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className="bg-success">Confirmées</Legend>
        <Legend className="bg-danger">Annulées</Legend>
        <Legend className="bg-chart-1">À traiter / autres</Legend>
        <span className="num">1 point = {unit} commande{unit > 1 ? "s" : ""}</span>
      </figcaption>
    </figure>
  )
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} aria-hidden />
      {children}
    </span>
  )
}

/** A row of `total` dots, the first `ratio × total` filled (gauges and ranked bars). */
export function DotBar({ ratio, total = 20, className, label }: { ratio: number; total?: number; className?: string; label: string }) {
  const n = ratio > 0 ? Math.max(1, Math.round(Math.min(1, ratio) * total)) : 0
  return (
    <svg viewBox={`0 0 ${total * GAP} ${GAP}`} role="img" aria-label={label} className={cn("h-2.5 w-full", className)} preserveAspectRatio="xMinYMid meet">
      {Array.from({ length: total }, (_, i) => (
        <circle key={i} cx={i * GAP + GAP / 2} cy={GAP / 2} r={R} className={i < n ? "fill-current" : "fill-muted-foreground/15"} />
      ))}
    </svg>
  )
}
