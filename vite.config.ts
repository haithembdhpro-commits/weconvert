import path from "node:path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Same refusal as the legacy build: only a publishable key may reach the browser bundle.
const key = process.env.VITE_SUPABASE_KEY ?? ""
if (/service_role|sb_secret_/.test(key)) throw new Error("Refusing to embed a secret key in the browser bundle.")

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@domain": path.resolve(__dirname, "src/domain"),
    },
  },
  base: "./",
  build: { sourcemap: false, target: "es2022" },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
})
