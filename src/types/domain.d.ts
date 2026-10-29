declare module "@domain/domain.mjs" {
  export const STATUS: Record<string, [string, string]>
  export const PENDING: string[]
  export const CHANNELS: Record<string, string>
  export function requestId(): string
  export function initialsOf(value: unknown): string
  export function orderAmount(items: { unit_price: number | string; quantity: number | string }[], fee?: number | string, discount?: number | string): number
  export function csvCell(value: unknown): string
  export function localInputToISO(value: string): string
  export function errorMessage(error: unknown): string
}
declare module "@domain/report-domain.mjs" {
  export function algerToday(now?: Date): string
  export function reportRange(preset?: string, today?: string): { from: string; to: string }
  export function reportRate(n: unknown, denominator: unknown): string
  export function reportBuckets(days: { date: string; orders?: number; confirmed?: number; cancelled?: number }[]): { key: string; from: string; to: string; orders: number; confirmed: number; cancelled: number }[]
  export const REPORT_MARKS: { confirmation: number; delivery: number; firstCallMinutes: number; wilayaReturns: number; wilayaMinParcels: number }
  export function deliveryRate(delivered: unknown, returned: unknown): string
  export function minutesLabel(minutes: unknown): string
  export function sortWilayas<T extends Record<string, any>>(rows: T[], mode?: string, marks?: typeof REPORT_MARKS): T[]
  export function reportAlerts(insights: unknown, marks?: typeof REPORT_MARKS): { key: string; tone: "warning" | "danger"; title: string; detail: string }[]
}
declare module "@domain/live-sync.mjs" {
  type Ctx = { userId: string; workspaceId: string; storeId: string }
  export function createLiveSync(opts: {
    client: unknown
    onChange: (ctx: Ctx) => Promise<unknown> | unknown
    onState?: (s: string) => void
    onSignal?: (s: { revision?: unknown; commitTimestamp?: string }) => void
  }): { watch: (ctx: Ctx | null) => void; stop: () => void; invalidate: () => void; readonly active: boolean }
}
