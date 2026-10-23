import type { Locale } from "./locale"

// Explicit imports keep the standalone bundle complete and make new namespaces reviewable.
export async function loadMessages(locale: Locale) {
  const [common, nav, auth, settings, errors, onboarding, admin, notifications, mail, accounts, loans, goals, statementImport] = await Promise.all([
    import(`../../messages/${locale}/common.json`),
    import(`../../messages/${locale}/nav.json`),
    import(`../../messages/${locale}/auth.json`),
    import(`../../messages/${locale}/settings.json`),
    import(`../../messages/${locale}/errors.json`),
    import(`../../messages/${locale}/onboarding.json`),
    import(`../../messages/${locale}/admin.json`),
    import(`../../messages/${locale}/notifications.json`),
    import(`../../messages/${locale}/mail.json`),
    import(`../../messages/${locale}/accounts.json`),
    import(`../../messages/${locale}/loans.json`),
    import(`../../messages/${locale}/goals.json`),
    import(`../../messages/${locale}/import.json`),
  ])
  return {
    common: common.default,
    nav: nav.default,
    auth: auth.default,
    settings: settings.default,
    errors: errors.default,
    onboarding: onboarding.default,
    admin: admin.default,
    notifications: notifications.default,
    mail: mail.default,
    accounts: accounts.default,
    loans: loans.default,
    goals: goals.default,
    import: statementImport.default,
  }
}
