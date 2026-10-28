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
