import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { readHash } from "@/lib/router"
import { StatusBadge } from "@/components/app/tone"
import { orderCode, money } from "@/lib/format"

describe("router", () => {
  it("falls back to the dashboard for unknown routes and keeps the sub-tab", () => {
    location.hash = "#nope"
    expect(readHash()).toEqual({ route: "dashboard", tab: "" })
    location.hash = "#orders/confirmed"
    expect(readHash()).toEqual({ route: "orders", tab: "confirmed" })
  })
})

describe("status badge", () => {
  it("always carries the text label, never colour alone", () => {
    render(<StatusBadge status="fake" />)
    expect(screen.getByText("Faux numéro")).toBeInTheDocument()
  })
})

describe("format", () => {
  it("formats order codes and DZD amounts like the legacy UI", () => {
    expect(orderCode({ number: 42 })).toBe("WC00042")
    expect(money(4900).replace(/\s/g, " ")).toBe("4 900 DA")
  })
})

describe("delivery column", () => {
  it("shows the carrier state and tracking, or a dash without parcel", async () => {
    const { DeliveryBadge } = await import("@/components/app/orders")
    const base = { id: "1", number: 1, version: 1, customer_name: "A", phone: "", wilaya: "", commune: "", address: "", channel: "website", delivery_type: "home", status: "confirmed", assigned_to: null, callback_at: null, attempts: 0, fee: 0, discount: 0, total: 0, created_at: "", items: [] } as any
    const { unmount } = render(<DeliveryBadge o={{ ...base, shipment: { state: "delivered", raw_status: "Livré", tracking: "TRK-1", updated_at: "" } }} />)
    expect(screen.getByText("Livré")).toBeInTheDocument()
    expect(screen.getByText("TRK-1")).toBeInTheDocument()
    unmount()
    render(<DeliveryBadge o={{ ...base, shipment: null }} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
