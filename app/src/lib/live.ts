import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createLiveSync } from "@domain/live-sync.mjs"
import { supabase } from "./supabase"
import { useSession } from "./session"

export type LiveState = "idle" | "connecting" | "connected" | "retrying"

/**
 * One protected signal per store (crm_live_stores, no customer data). On a signal, every active query of
 * that store is refetched through RLS. Queries keep their previous data while refetching, and forms live in
 * component state, so searches, filters, selections and drafts survive live updates by construction.
 */
export function useLiveSync() {
  const { user, workspace, store } = useSession()
  const qc = useQueryClient()
  const [state, setState] = useState<LiveState>("connecting")
  const [lastSync, setLastSync] = useState<number | null>(null)
  const syncRef = useRef<ReturnType<typeof createLiveSync> | null>(null)

  if (!syncRef.current) {
    syncRef.current = createLiveSync({
      client: supabase,
      onState: (s) => setState(s as LiveState),
      onChange: async (ctx) => {
        if (document.visibilityState === "hidden") return
        await qc.refetchQueries({ queryKey: ["store", ctx.storeId], type: "active" }, { throwOnError: true })
        setLastSync(Date.now())
      },
    })
  }

  useEffect(() => {
    const sync = syncRef.current!
    sync.watch(user && workspace && store ? { userId: user.id, workspaceId: workspace, storeId: store } : null)
  }, [user, workspace, store])

  useEffect(() => {
    const sync = syncRef.current!
    const invalidate = () => sync.invalidate()
    const onVisible = () => document.visibilityState === "visible" && sync.invalidate()
    window.addEventListener("online", invalidate)
    window.addEventListener("pageshow", invalidate)
    document.addEventListener("visibilitychange", onVisible)
    // Reconcile after reconnects and advance due callbacks; WebSocket events drive immediate updates.
    const timer = setInterval(() => document.visibilityState === "visible" && sync.invalidate(), 30000)
    return () => {
      window.removeEventListener("online", invalidate)
      window.removeEventListener("pageshow", invalidate)
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(timer)
      sync.stop()
    }
  }, [])

  return { state, lastSync }
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  return online
}
