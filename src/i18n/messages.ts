import type { Locale } from "./locale"

// Explicit imports keep the standalone bundle complete and make new namespaces reviewable.
export async function loadMessages(locale: Locale) {
  const [common, nav, auth, settings, errors, onboarding] = await Promise.all([
    import(`../../messages/${locale}/common.json`),
    import(`../../messages/${locale}/nav.json`),
    import(`../../messages/${locale}/auth.json`),
    import(`../../messages/${locale}/settings.json`),
    import(`../../messages/${locale}/errors.json`),
    import(`../../messages/${locale}/onboarding.json`),
  ])
  return { common: common.default, nav: nav.default, auth: auth.default, settings: settings.default, errors: errors.default, onboarding: onboarding.default }
}
