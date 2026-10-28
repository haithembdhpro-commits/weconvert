import { STATUS } from "@domain/domain.mjs"
import { cn } from "@/lib/utils"

export type Tone = "violet" | "info" | "warning" | "success" | "neutral" | "danger"

// Legacy palette names from domain.mjs mapped to semantic tones. Statuses are never brand-blue-only:
// the text label always carries the meaning, the tone only reinforces it.
const LEGACY: Record<string, Tone> = { purple: "violet", blue: "info", orange: "warning", green: "success", gray: "neutral", red: "danger" }

export const toneClass: Record<Tone, string> = {
  violet: "bg-violet-soft text-violet",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  neutral: "bg-neutral-soft text-neutral",
  danger: "bg-danger-soft text-danger",
}

export function ToneBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", toneClass[tone], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const [label, legacy] = STATUS[status] || [status, "gray"]
  return <ToneBadge tone={LEGACY[legacy] || "neutral"}>{label}</ToneBadge>
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 place-items-center rounded-xl bg-brand text-[#001320]", className)} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5.5" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    </span>
  )
}
