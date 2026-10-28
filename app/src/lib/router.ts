import { useEffect, useState } from "react"

export type RouteState = { route: string; tab: string }

export const ROUTES = new Set([
  "dashboard", "performance", "orders", "confirmation", "shipping", "returns", "products", "clients",
  "purchases", "finance", "ads", "suite", "messages", "automation", "team", "integrations", "pos", "settings",
])

export function readHash(): RouteState {
  const [r = "", t = ""] = location.hash.slice(1).split("/")
  return { route: ROUTES.has(r) ? r : "dashboard", tab: t }
}

export function navigate(route: string, tab = "") {
  const hash = "#" + route + (tab ? "/" + tab : "")
  if (location.hash !== hash) location.hash = hash
}

export function useHashRoute() {
  const [state, setState] = useState(readHash)
  useEffect(() => {
    const on = () => setState(readHash())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return state
}
