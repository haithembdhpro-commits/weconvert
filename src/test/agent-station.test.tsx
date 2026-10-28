import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useCommandShortcut } from "@/components/app/command-menu"
import { ContactActions, waLink } from "@/components/app/orders"
import { WILAYAS } from "@/lib/wilayas"

describe("contact actions", () => {
  it("builds WhatsApp links from local and international numbers", () => {
    expect(waLink("0555 12 34 56")).toBe("https://wa.me/213555123456")
    expect(waLink("+213555123456")).toBe("https://wa.me/213555123456")
    expect(waLink("+33612345678")).toBe("https://wa.me/33612345678")
  })

  it("labels every icon action for screen readers", () => {
    render(<ContactActions phone="+213555123456" />)
    expect(screen.getByLabelText("Appeler le +213555123456")).toHaveAttribute("href", "tel:+213555123456")
    expect(screen.getByLabelText("Écrire sur WhatsApp au +213555123456")).toHaveAttribute("href", "https://wa.me/213555123456")
    expect(screen.getByLabelText("Copier le +213555123456")).toBeInTheDocument()
  })
})

describe("wilayas", () => {
  it("lists the 69 official wilayas once each, with a code carriers can read", () => {
    expect(WILAYAS).toHaveLength(69)
    expect(new Set(WILAYAS.map((w) => w.value)).size).toBe(69)
    expect(WILAYAS[15].value).toBe("16 - Alger")
    expect(WILAYAS[68].value).toBe("69 - El Abiodh Sidi Cheikh")
    // Same extraction as the ZR shipping dialog.
    for (const w of WILAYAS) expect(Number((w.value.match(/^\s*(\d{1,2})(?:\s|[-–.])/) || [])[1])).toBe(w.code)
  })
})

function ShortcutProbe({ onOpen }: { onOpen: () => void }) {
  useCommandShortcut(onOpen)
  return null
}

describe("command shortcut", () => {
  it("opens on Ctrl+K and ⌘K, not on a plain k", () => {
    let n = 0
    render(<ShortcutProbe onOpen={() => n++} />)
    fireEvent.keyDown(window, { key: "k" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.keyDown(window, { key: "K", metaKey: true })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, shiftKey: true })
    expect(n).toBe(2)
  })
})
