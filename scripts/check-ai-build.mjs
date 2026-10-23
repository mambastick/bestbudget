import { readFile } from "node:fs/promises"

// A deployable build must bake mock=false, independently of the runtime environment.
// Playwright builds its separate test artifact with `next build` directly.
const manifest = JSON.parse(await readFile(new URL("../.next/required-server-files.json", import.meta.url), "utf8"))
if (manifest.config?.env?.NEXT_PUBLIC_AI_TEST_BUILD !== "0") {
  throw new Error("Refusing a production artifact without the disabled AI mock gate")
}
