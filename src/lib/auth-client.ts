"use client"

import { adminClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [adminClient()],
})

/** Maps Better Auth error codes to Russian messages. */
export function authErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!error) return "Не удалось выполнить запрос"
  if (error.status === 429) return "Слишком много попыток. Подождите минуту и попробуйте снова."
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Неверный e-mail или пароль"
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Пользователь с таким e-mail уже существует"
    case "PASSWORD_TOO_SHORT":
      return "Пароль слишком короткий (минимум 10 символов)"
    case "PASSWORD_TOO_LONG":
      return "Пароль слишком длинный"
    case "INVALID_PASSWORD":
      return "Неверный текущий пароль"
    case "BANNED_USER":
      return "Аккаунт заблокирован администратором"
    case "EMAIL_PASSWORD_DISABLED":
    case "EMAIL_AND_PASSWORD_SIGN_IN_IS_NOT_ENABLED":
      return "Вход по паролю отключён администратором"
    case "INVALID_TOKEN":
      return "Ссылка недействительна или устарела"
    case "SOCIAL_ACCOUNT_ALREADY_LINKED":
      return "Этот SSO-аккаунт уже привязан к другому пользователю"
    default:
      return error.message || "Не удалось выполнить запрос"
  }
}
