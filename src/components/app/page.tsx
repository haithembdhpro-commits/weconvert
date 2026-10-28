import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, Info, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { f } from "@/lib/format"
import { cn } from "@/lib/utils"

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ title = "Aucun résultat", description = "Essayez une autre recherche ou modifiez les filtres.", icon, action }: { title?: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-primary [&_svg]:size-5">{icon ?? <SearchX />}</span>
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Notice({ children, tone = "info", className, role = "status" }: { children: ReactNode; tone?: "info" | "warning" | "danger"; className?: string; role?: "status" | "alert" }) {
  const t = tone === "warning" ? "bg-warning-soft text-warning" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-info-soft text-info"
  return (
    <div role={role} className={cn("flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm", t, className)}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Pager({ total, page, size = 20, onPage }: { total: number; page: number; size?: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="num">
        {f(total)} résultat{total > 1 ? "s" : ""} · {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
          <ChevronLeft />
        </Button>
        <span className="num px-2">
          Page {page} / {last}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label="Page suivante">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

export function FormField({ label, htmlFor, required, hint, children, className }: { label: string; htmlFor: string; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function FormError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  )
}

export function Loading({ text = "Chargement de vos données…" }: { text?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 px-4 py-10 text-sm text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      {text}
    </div>
  )
}
