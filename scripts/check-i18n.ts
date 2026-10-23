import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { translatedPaths, allowedLiterals, excludedPaths } from "./i18n.config"

function filesAt(file: string): string[] {
  if (!fs.statSync(file).isDirectory()) return [file]
  return fs.readdirSync(file).flatMap((child) => filesAt(path.join(file, child)))
}

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix]
  if (!value || typeof value !== "object") throw new Error(`Invalid message at ${prefix}`)
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const namespaces = new Set(["ru", "en"].flatMap((locale) => fs.readdirSync(`messages/${locale}`).filter((f) => f.endsWith(".json"))))
let failures = 0
const allKeys: string[] = []
for (const file of namespaces) {
  const keys = ["ru", "en"].map((locale) => {
    const filename = `messages/${locale}/${file}`
    if (!fs.existsSync(filename)) { console.error(`Missing namespace: ${filename}`); failures++; return [] }
    return flatten(JSON.parse(fs.readFileSync(filename, "utf8"))).sort()
  })
  for (const key of new Set([...keys[0]!, ...keys[1]!])) {
    if (!keys[0]!.includes(key) || !keys[1]!.includes(key)) { console.error(`Key parity: ${file}:${key}`); failures++ }
    allKeys.push(`${file.slice(0, -5)}.${key}`)
  }
}

const sources = ["src", "scripts/backup"].flatMap(filesAt).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f) && !f.includes("/fixtures/"))
for (const file of new Set(translatedPaths.flatMap(filesAt))) {
  if (!sources.includes(file) || excludedPaths.includes(file)) continue
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      if (/[\u0400-\u04ff]/.test(node.text) && !allowedLiterals.includes(node.text)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
        console.error(`Untranslated literal: ${file}:${line + 1}:${character + 1} ${JSON.stringify(node.text.trim())}`)
        failures++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

// Conservative static hints: dynamic keys/translator parameters need human review, never removal on this evidence alone.
const code = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n")
const unused = allKeys.filter((key) => {
  const parts = key.split(".")
  return !parts.some((_, index) => code.includes(JSON.stringify(parts.slice(index).join("."))))
})
if (unused.length) console.warn(`Warning: ${unused.length} possibly unused keys (dynamic references included):\n${unused.join("\n")}`)
console.log(`i18n: ${namespaces.size} namespaces, ${allKeys.length} keys, ${failures} errors`)
process.exitCode = failures ? 1 : 0
