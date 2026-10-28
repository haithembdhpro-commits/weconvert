import type { FormEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormError } from "./page"

/** A dialog wrapping one form: Escape and outside clicks are ignored while a request is in flight. */
export function FormDialog({
  id, title, description, submitLabel, busy, error, onClose, onSubmit, children, wide,
}: {
  id: string
  title: string
  description?: ReactNode
  submitLabel: string
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (data: Record<string, string>, form: HTMLFormElement) => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={wide ? "max-h-[92dvh] overflow-y-auto sm:max-w-2xl" : "max-h-[92dvh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <form
          id={id}
          className="grid gap-4"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>, e.currentTarget)
          }}
        >
          {children}
          <FormError message={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form={id} disabled={busy} aria-busy={busy}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
