import { defineConfig } from "@playwright/test"
import acceptance from "./playwright.config"

/** Isolated seeded demo: same production server and fixed ports as acceptance, no owner data or network. */
export default defineConfig({
  ...acceptance,
  testDir: "tests/screenshots",
  outputDir: "work/playwright-screenshots",
  timeout: 120_000,
})
