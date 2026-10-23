export function plural(n: number, one: string, few: string, many: string, locale = "ru", other = many): string {
  const form = new Intl.PluralRules(locale).select(n)
  return form === "one" ? one : form === "few" ? few : form === "many" ? many : other
}
