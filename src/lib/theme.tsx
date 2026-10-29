import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"

type Theme = "light" | "dark"
/** What the user chose; « system » follows the device and changes with it. */
export type ThemeMode = Theme | "system"
const ThemeCtx = createContext<{ theme: Theme; mode: ThemeMode; toggle: () => void; setMode: (m: ThemeMode) => void }>({
  theme: "light",
  mode: "light",
  toggle: () => {},
  setMode: () => {},
})

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches

function read(): ThemeMode {
  try {
    const v = localStorage.getItem("wc-theme")
    return v === "dark" || v === "system" ? v : "light"
  } catch {
    return "light"
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(read)
  const [system, setSystem] = useState<Theme>(() => (prefersDark() ? "dark" : "light"))
  const theme: Theme = mode === "system" ? system : mode
  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const q = matchMedia("(prefers-color-scheme: dark)")
    const on = () => setSystem(q.matches ? "dark" : "light")
    q.addEventListener("change", on)
    return () => q.removeEventListener("change", on)
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])
  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      localStorage.setItem("wc-theme", m)
    } catch {}
  }, [])
  const toggle = useCallback(() => setMode(theme === "dark" ? "light" : "dark"), [theme, setMode])
  return <ThemeCtx.Provider value={{ theme, mode, toggle, setMode }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
