/** Expand this list when a whole area has been translated and reviewed in both locales. */
export const translatedPaths = [
  "src/i18n", "src/components/auth", "src/components/app/settings", "src/components/app/preferences.tsx",
  "src/components/app/app-shell.tsx", "src/components/app/confirm-dialog.tsx", "src/components/app/empty-state.tsx",
  "src/components/app/date-field.tsx", "src/components/app/money-input.tsx", "src/components/app/segmented.tsx",
  "src/components/app/money.tsx", "src/components/ui/sonner.tsx",
  "src/components/ui/sidebar.tsx", "src/components/ui/dialog.tsx", "src/components/ui/sheet.tsx",
  "src/components/app/currency-select.tsx", "src/hooks/use-action.ts", "src/app/(auth)", "src/app/onboarding",
  "src/app/(app)/settings", "src/app/(app)/error.tsx", "src/app/(app)/loading.tsx", "src/app/not-found.tsx",
  "src/app/layout.tsx", "src/app/manifest.ts", "src/server/errors.ts", "src/app/actions/preferences.ts",
  "src/app/actions/auth.ts", "src/server/services/preferences.ts", "src/server/services/catalog.ts",
  "src/server/services/households.ts", "src/lib/auth-client.ts", "src/lib/timezones.ts", "src/lib/auth.ts",
] as const

// Language autonyms remain readable even when the surrounding interface uses another language.
export const allowedLiterals: readonly string[] = ["Русский"]
