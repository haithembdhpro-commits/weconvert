const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
const moneyFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 })

export const f = (n: unknown) => intFmt.format(Number(n) || 0)
export const money = (n: unknown) => moneyFmt.format(Number(n) || 0) + " DA"
export const time = (at?: string | null) =>
  at ? new Date(at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "medium", timeStyle: "short" }) : "—"
export const shortDate = (at: string) =>
  new Date(at).toLocaleDateString("fr-FR", { timeZone: "Africa/Algiers", day: "2-digit", month: "short" })
export const orderCode = (o: { number: number | string }) => "WC" + String(o.number).padStart(5, "0")
export const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)
