import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AUTH_ENTRY, supabase } from "./supabase"
import { clearPendingCommands, command as rawCommand, safeError, select } from "./api"
import type { Member, Role, Store, Workspace } from "./types"

export type AuthMode = "login" | "signup" | "reset" | "password"
type Phase = "booting" | "auth" | "onboarding" | "app"

type Ctx = {
  phase: Phase
  user: User | null
  authMode: AuthMode
  authInfo: string
  setAuthMode: (m: AuthMode) => void
  setAuthInfo: (s: string) => void
  workspace: string | null
  workspaces: Workspace[]
  stores: Store[]
  store: string | null
  role: Role | null
  members: Member[]
  manager: boolean
  hasInvitation: boolean
  loadContext: (preferred?: string) => Promise<void>
  selectStore: (id: string) => void
  selectWorkspace: (id: string) => Promise<void>
  discardInvitation: () => void
  logout: () => Promise<void>
  command: <T = any>(action: string, payload: Record<string, unknown>) => Promise<T>
  memberName: (id: string | null | undefined) => string
  storeName: string
  workspaceName: string
}

const SessionCtx = createContext<Ctx | null>(null)

const storage = {
  get: (s: Storage, k: string) => {
    try { return s.getItem(k) } catch { return null }
  },
  set: (s: Storage, k: string, v: string) => {
    try { s.setItem(k, v) } catch {}
  },
  del: (s: Storage, k: string) => {
    try { s.removeItem(k) } catch {}
  },
}

// #oauth/<provider>/<ticket> and #join/<token> are consumed once, then replaced by a normal route.
function captureEntryHash(): string {
  // An expired or reused e-mail link, or a cancelled Google/Microsoft/Apple/Facebook sign-in, comes back as #error=…
  if (AUTH_ENTRY.error) {
    history.replaceState(null, "", location.pathname + location.search)
    const { code, text } = AUTH_ENTRY.error
    if (code === "otp_expired") return "Ce lien a expiré ou a déjà été utilisé. Cliquez sur « Mot de passe oublié » pour en recevoir un nouveau."
    if (code === "access_denied" && !/expired|invalid/i.test(text)) return "Connexion annulée. Vous pouvez réessayer."
    return "Le lien n’a pas pu être utilisé" + (text ? " : " + text : ".") + " Réessayez ou demandez un nouveau lien."
  }
  const oauth = /^#oauth\/(shopify|youcan)\/([a-f0-9]{64})$/.exec(location.hash)
  if (oauth) {
    storage.set(sessionStorage, "wc-oauth", JSON.stringify({ provider: oauth[1], ticket: oauth[2] }))
    history.replaceState(null, "", location.pathname + location.search + "#integrations")
  }
  if (location.hash.startsWith("#join/")) {
    try {
      sessionStorage.setItem("wc-invitation", decodeURIComponent(location.hash.slice(6)))
    } catch {
      history.replaceState(null, "", location.pathname + location.search + "#dashboard")
      return "Lien d’invitation illisible. Demandez un nouveau lien."
    }
    history.replaceState(null, "", location.pathname + location.search + "#dashboard")
  }
  return ""
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>("booting")
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(AUTH_ENTRY.recovery ? "password" : "login")
  const [authInfo, setAuthInfo] = useState("")
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [store, setStore] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [hasInvitation, setHasInvitation] = useState(() => !!storage.get(sessionStorage, "wc-invitation"))
  const epoch = useRef(0)
  const userRef = useRef<User | null>(null)
  // A password-reset link signs the user in: they must choose a new password before entering the CRM.
  const recovery = useRef(AUTH_ENTRY.recovery)
  const wsRef = useRef<string | null>(null)
  const storeRef = useRef<string | null>(null)
  userRef.current = user
  wsRef.current = workspace
  storeRef.current = store

  const clear = useCallback(() => {
    ++epoch.current
    setUser(null)
    setWorkspace(null)
    setWorkspaces([])
    setStores([])
    setStore(null)
    setRole(null)
    setMembers([])
    clearPendingCommands()
    qc.clear()
  }, [qc])

  const consumeOAuthTicket = useCallback(async () => {
    let pending: { provider?: string; ticket?: string } | null = null
    try {
      pending = JSON.parse(sessionStorage.getItem("wc-oauth") || "null")
      sessionStorage.removeItem("wc-oauth")
    } catch {}
    if (!pending || !["shopify", "youcan"].includes(pending.provider || "") || !/^[a-f0-9]{64}$/.test(pending.ticket || "")) return
    const name = pending.provider === "shopify" ? "Shopify" : "YouCan"
    try {
      const { data, error } = await supabase.functions.invoke("weconvert-" + pending.provider, {
        body: { action: "confirm", ticket: pending.ticket },
      })
      if (error || data?.error) throw Error("INVALID_STATE")
      toast.success("Connexion " + name + " confirmée.")
    } catch {
      toast.error(
        "La connexion " + name + " n’a pas pu être confirmée : elle doit être validée par la personne qui l’a lancée, dans les 10 minutes. Relancez-la depuis Intégrations.",
      )
    }
    qc.invalidateQueries()
  }, [qc])

  const loadContext = useCallback(
    async (preferred?: string) => {
      const e = ++epoch.current
      recovery.current = false // reached only once the new password is saved, or outside a reset link
      const u = userRef.current
      if (!u) {
        setPhase("auth")
        return
      }
      const { data: memberships } = await select<{ workspace_id: string; role: Role }[]>(
        supabase.from("crm_members").select("workspace_id,role").eq("user_id", u.id).eq("active", true),
      )
      if (e !== epoch.current) return
      if (!memberships.length) {
        setWorkspace(null)
        setStore(null)
        setMembers([])
        setPhase("onboarding")
        return
      }
      const want = preferred || wsRef.current || storage.get(localStorage, "wc-workspace-" + u.id)
      const m = memberships.find((x) => x.workspace_id === want) || memberships[0]
      const [ws, st, mb] = await Promise.all([
        select<Workspace[]>(supabase.from("crm_workspaces").select("id,name").order("created_at")),
        select<Store[]>(supabase.from("crm_stores").select("id,name,workspace_id").eq("workspace_id", m.workspace_id).order("created_at")),
        select<Member[]>(supabase.from("crm_members").select("user_id,display_name,role,active").eq("workspace_id", m.workspace_id).order("created_at")),
      ])
      if (e !== epoch.current) return
      const sameWorkspace = wsRef.current === m.workspace_id
      const storeChoice = (sameWorkspace && storeRef.current) || storage.get(localStorage, "wc-store-" + u.id + "-" + m.workspace_id)
      const nextStore = st.data.find((x) => x.id === storeChoice)?.id || st.data[0]?.id || null
      setWorkspaces(ws.data)
      setWorkspace(m.workspace_id)
      setRole(m.role)
      setMembers(mb.data)
      setStores(st.data)
      setStore(nextStore)
      storage.set(localStorage, "wc-workspace-" + u.id, m.workspace_id)
      setPhase("app")
      void consumeOAuthTicket()
    },
    [consumeOAuthTicket],
  )

  // Boot: entry links, existing session, then auth events.
  useEffect(() => {
    const info = captureEntryHash()
    if (info) setAuthInfo(info)
    setHasInvitation(!!storage.get(sessionStorage, "wc-invitation"))
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!data.session) {
          if (!cancelled) setPhase("auth")
          return
        }
        const result = await supabase.auth.getUser()
        if (result.error) throw result.error
        if (cancelled) return
        userRef.current = result.data.user
        setUser(result.data.user)
        if (recovery.current) {
          setAuthMode("password")
          setPhase("auth")
          return
        }
        await loadContext()
      } catch (error) {
        if (!cancelled) {
          setAuthInfo(safeError(error))
          setPhase("auth")
        }
      }
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        recovery.current = false
        clear()
        setPhase("auth")
      }
      if (event === "PASSWORD_RECOVERY") {
        recovery.current = true
        userRef.current = session?.user ?? null
        setUser(session?.user ?? null)
        setAuthMode("password")
        setPhase("auth")
      }
      if (event === "SIGNED_IN" && !recovery.current && session?.user.id !== userRef.current?.id) {
        setTimeout(async () => {
          userRef.current = session!.user
          setUser(session!.user)
          try {
            await loadContext()
          } catch (error) {
            setAuthInfo(safeError(error))
            setPhase("auth")
          }
        }, 0)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectStore = useCallback(
    (id: string) => {
      if (!stores.some((s) => s.id === id) || !user || !workspace) return
      storage.set(localStorage, "wc-store-" + user.id + "-" + workspace, id)
      setStore(id)
    },
    [stores, user, workspace],
  )

  const selectWorkspace = useCallback(
    async (id: string) => {
      if (!workspaces.some((w) => w.id === id)) return
      setStore(null)
      storeRef.current = null
      await loadContext(id)
    },
    [workspaces, loadContext],
  )

  const discardInvitation = useCallback(() => {
    storage.del(sessionStorage, "wc-invitation")
    setHasInvitation(false)
  }, [])

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" })
    if (error) throw error
    clear()
    setAuthMode("login")
    setPhase("auth")
  }, [clear])

  const command = useCallback(
    <T,>(action: string, payload: Record<string, unknown>) => {
      if (!user || !workspace) throw Error("FORBIDDEN")
      return rawCommand<T>({ userId: user.id, workspaceId: workspace }, action, payload)
    },
    [user, workspace],
  )

  const value = useMemo<Ctx>(() => {
    const memberName = (id: string | null | undefined) => members.find((m) => m.user_id === id)?.display_name || "Non attribué"
    return {
      phase,
      user,
      authMode,
      authInfo,
      setAuthMode: (m) => {
        setAuthMode(m)
        setAuthInfo("")
      },
      setAuthInfo,
      workspace,
      workspaces,
      stores,
      store,
      role,
      members,
      manager: role === "owner" || role === "admin",
      hasInvitation,
      loadContext,
      selectStore,
      selectWorkspace,
      discardInvitation,
      logout,
      command,
      memberName,
      storeName: stores.find((s) => s.id === store)?.name || "Votre boutique",
      workspaceName: workspaces.find((w) => w.id === workspace)?.name || "E-commerce COD",
    }
  }, [phase, user, authMode, authInfo, workspace, workspaces, stores, store, role, members, hasInvitation, loadContext, selectStore, selectWorkspace, discardInvitation, logout, command])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw Error("SessionProvider missing")
  return ctx
}

export function useSetUserAfterAuth() {
  // Exposed for the auth form: the SIGNED_IN event also loads the context, this only shortens the wait.
  return useSession().loadContext
}
