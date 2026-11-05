import { describe, expect, it } from "vitest"
import { repairMarkdownTail } from "./markdown"

const live = (text: string) => repairMarkdownTail(text, { streaming: true })
const final = (text: string) => repairMarkdownTail(text, { streaming: false })

describe("repairMarkdownTail", () => {
  it("drops a marker that has no text after it", () => {
    expect(final("- Обязательные платежи **")).toBe("- Обязательные платежи")
    expect(live("Итог ~~")).toBe("Итог")
    expect(live("Итог *")).toBe("Итог")
  })
  it("closes a marker that already has text", () => {
    expect(live("Итог **100 ₽")).toBe("Итог **100 ₽**")
    expect(live("Итог **100 ₽ ")).toBe("Итог **100 ₽**")
    expect(live("Итог ~~старый")).toBe("Итог ~~старый~~")
    expect(live("Итог *важно")).toBe("Итог *важно*")
    expect(live("**жирный *курсив")).toBe("**жирный *курсив***")
  })
  it("leaves finished and non-emphasis text untouched", () => {
    for (const text of [
      "**жирный** и *курсив*",
      "2 * 3 = 6",
      "2*3 = 6",
      "snake_case_name",
      "* пункт списка",
      "---",
      "***",
      "примерно ~5000 ₽",
      "экранировано \\*\\*",
      "код `a ** b` готов",
    ])
      expect(final(text)).toBe(text)
  })
  it("only looks at the last line", () => {
    expect(final("- **один\n- два")).toBe("- **один\n- два")
  })
  it("closes inline code and leaves an open fence alone", () => {
    expect(live("значение `total")).toBe("значение `total`")
    expect(live("значение `")).toBe("значение ")
    expect(live("```\nconst a = 2 ** 3")).toBe("```\nconst a = 2 ** 3")
  })
  it("reduces an unfinished link to its text", () => {
    expect(live("см. [план](https://exa")).toBe("см. план")
    expect(live("см. [пла")).toBe("см. пла")
    expect(live("см. ![схема](https://exa")).toBe("см. схема")
    expect(final("см. [план](https://example.com)")).toBe("см. [план](https://example.com)")
  })
  it("hides an unfinished HTML tag but not a comparison", () => {
    expect(live('текст <img src="https://exa')).toBe("текст ")
    expect(live("сумма <5000 ₽")).toBe("сумма <5000 ₽")
  })
  it("holds a table back until its delimiter row is complete", () => {
    const intro = "Вот таблица:\n\n"
    expect(live(`${intro}| Карта | Долг |`)).toBe("Вот таблица:")
    expect(live(`${intro}| Карта | Долг |\n|---`)).toBe("Вот таблица:")
    expect(live(`${intro}| Карта | Долг |\n|---|---`)).toBe("Вот таблица:")
    expect(live(`${intro}| Карта | Долг |\n|---|---|\n`)).toBe(`${intro}| Карта | Долг |\n|---|---|\n`)
    expect(live(`${intro}| Карта | Долг |\n|---|---|\n| А | **100`)).toBe(`${intro}| Карта | Долг |\n|---|---|\n| А | **100**`)
  })
  it("does not hold a table back once the text is final", () => {
    expect(final("| Карта | Долг |")).toBe("| Карта | Долг |")
  })
})
