import { useEffect } from "react"
import { AppShell, TITLES } from "@/components/app/AppShell"
import { OrderUIProvider } from "@/components/app/orders"
import { useHashRoute } from "@/lib/router"
import { useSession } from "@/lib/session"
import { AuthScreen, BootScreen, OnboardingScreen } from "@/pages/AuthScreen"
import { Confirmation } from "@/pages/Confirmation"
import { Dashboard } from "@/pages/Dashboard"
import { Orders } from "@/pages/Orders"
import { Planned } from "@/pages/Planned"
import { Integrations } from "@/pages/Integrations"
import { Performance } from "@/pages/Performance"
import { Shipping } from "@/pages/Shipping"
import { Products } from "@/pages/Products"
import { Settings } from "@/pages/Settings"
import { Team } from "@/pages/Team"

function Page({ route, tab }: { route: string; tab: string }) {
  switch (route) {
    case "dashboard": return <Dashboard />
    case "orders": return <Orders tab={tab} />
    case "confirmation": return <Confirmation tab={tab} />
    case "products": return <Products />
    case "team": return <Team tab={tab} />
    case "settings": return <Settings />
    case "performance": return <Performance tab={tab} />
    case "shipping": return <Shipping />
    case "integrations": return <Integrations tab={tab} />
    default: return <Planned route={route} />
  }
}

export default function App() {
  const s = useSession()
  const r = useHashRoute()
  useEffect(() => {
    document.title = (s.phase === "app" ? TITLES[r.route] + " — " : "") + "WeConvert"
  }, [s.phase, r.route])
  // Focus the main region after navigation so screen-reader users land on the new page.
  useEffect(() => {
    if (s.phase === "app") document.getElementById("main")?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [r.route, s.phase])

  if (s.phase === "booting") return <BootScreen />
  if (s.phase === "auth") return <AuthScreen />
  if (s.phase === "onboarding") return <OnboardingScreen />
  if (!s.store) return <BootScreen />
  return (
    <OrderUIProvider key={s.store}>
      <AppShell route={r}>
        <Page key={s.store + r.route} route={r.route} tab={r.tab} />
      </AppShell>
    </OrderUIProvider>
  )
}
