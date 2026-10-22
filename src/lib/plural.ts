const rules = new Intl.PluralRules("ru")

export function plural(n: number, one: string, few: string, many: string): string {
  const form = rules.select(n)
  return form === "one" ? one : form === "few" ? few : many
}
