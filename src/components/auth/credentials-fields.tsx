"use client"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "./password-input"

export interface Credentials {
  name: string
  email: string
  password: string
  confirm: string
}

export const emptyCredentials: Credentials = { name: "", email: "", password: "", confirm: "" }

/** Client-side checks; the server validates again. */
export function validateCredentials(c: Credentials): string | null {
  if (!c.name.trim()) return "Укажите имя"
  if (!/^\S+@\S+\.\S+$/.test(c.email.trim())) return "Некорректный e-mail"
  if (c.password.length < 10) return "Пароль должен быть не короче 10 символов"
  if (c.password !== c.confirm) return "Пароли не совпадают"
  return null
}

export function CredentialsFields({ value, onChange }: { value: Credentials; onChange: (v: Credentials) => void }) {
  const set = (k: keyof Credentials) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <>
      <Field>
        <FieldLabel htmlFor="name">Имя</FieldLabel>
        <Input id="name" autoComplete="name" required value={value.name} onChange={set("name")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="email">E-mail</FieldLabel>
        <Input id="email" type="email" autoComplete="email" required value={value.email} onChange={set("email")} />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">Пароль</FieldLabel>
        <PasswordInput id="password" autoComplete="new-password" required minLength={10} value={value.password} onChange={set("password")} />
        <p className="text-xs text-muted-foreground">Не короче 10 символов</p>
      </Field>
      <Field>
        <FieldLabel htmlFor="confirm">Повторите пароль</FieldLabel>
        <PasswordInput id="confirm" autoComplete="new-password" required value={value.confirm} onChange={set("confirm")} />
      </Field>
    </>
  )
}
