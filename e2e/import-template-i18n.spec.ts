import { E2E_ENV } from "../playwright.config"
import { expect, test } from "./fixtures"

const header = "account;date;amount;currency;description;external_id;status;mcc"

for (const [locale, cashback] of [["ru", "Рублёвый кэшбэк"], ["en", "Cashback"]] as const) {
  test(`CSV template uses ${locale} and preserves the CSV v1 schema`, async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: E2E_ENV.APP_URL,
      extraHTTPHeaders: { "Accept-Language": locale },
    })
    try {
      const response = await request.get("/api/import/template")
      expect(response.ok()).toBe(true)
      expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8")
      expect(response.headers()["cache-control"]).toBe("no-store")
      const body = await response.body()
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      const lines = body.toString("utf8").slice(1).split("\r\n")
      expect(lines[0]).toBe(header)
      expect(lines[2]).toBe(`DEMO_DEBIT_A;2026-10-21;50.00;RUB;${cashback};;posted;`)
      expect(lines.slice(0, 3).every((line) => line.split(";").length === 8)).toBe(true)

      // A manual preference takes priority over the browser language.
      const overridden = await request.get("/api/import/template", {
        headers: { Cookie: `bb_locale=${locale === "ru" ? "en" : "ru"}` },
      })
      expect(await overridden.text()).toContain(locale === "ru" ? "Cashback" : "Рублёвый кэшбэк")
    } finally { await request.dispose() }
  })
}
