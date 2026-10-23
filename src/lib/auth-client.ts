"use client"

import { errorMessage } from "@/i18n/errors"
import { adminClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [adminClient()],
})

/** Never expose raw provider errors to the user. */
export function authErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined, locale = "ru"): string {
  if (!error) return errorMessage("auth.request", {}, locale)
  if (error.status === 429) return errorMessage("auth.rateLimit", {}, locale)
  switch (error.code) {
    case "oidc_access_denied":
      return errorMessage("auth.oidcAccessDenied", {}, locale)
    case "INVALID_EMAIL_OR_PASSWORD":
      return errorMessage("auth.credentials", {}, locale)
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return errorMessage("auth.exists", {}, locale)
    case "PASSWORD_TOO_SHORT":
      return errorMessage("auth.shortPassword", {}, locale)
    case "PASSWORD_TOO_LONG":
      return errorMessage("auth.longPassword", {}, locale)
    case "INVALID_PASSWORD":
      return errorMessage("auth.currentPassword", {}, locale)
    case "BANNED_USER":
      return errorMessage("auth.banned", {}, locale)
    case "EMAIL_PASSWORD_DISABLED":
    case "EMAIL_AND_PASSWORD_SIGN_IN_IS_NOT_ENABLED":
      return errorMessage("auth.passwordDisabled", {}, locale)
    case "INVALID_TOKEN":
      return errorMessage("auth.invalidLink", {}, locale)
    case "SOCIAL_ACCOUNT_ALREADY_LINKED":
      return errorMessage("auth.linked", {}, locale)
    default:
      return errorMessage("auth.request", {}, locale)
  }
}
