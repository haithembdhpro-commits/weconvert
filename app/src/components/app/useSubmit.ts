import { useState } from "react"
import { safeError } from "@/lib/api"

export function useSubmit() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(safeError(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run, reset: () => setError("") }
}
