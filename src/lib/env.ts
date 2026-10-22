import "server-only"
import { z } from "zod"

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "yes")

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.url("APP_URL must be the public URL of the application, e.g. https://budget.example.com"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: optionalString,
  SETUP_TOKEN: optionalString,
  AUTH_FORCE_LOCAL_LOGIN: bool,
  TRUST_PROXY: bool,
  FX_PROVIDER: z.enum(["cbr", "none"]).default("cbr"),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).optional(),

  OIDC_ISSUER: optionalString,
  OIDC_CLIENT_ID: optionalString,
  OIDC_CLIENT_SECRET: optionalString,
  OIDC_SCOPES: optionalString,
  OIDC_DISPLAY_NAME: optionalString,
  OIDC_REDIRECT_URI: optionalString,
  OIDC_ENABLED: z.enum(["true", "false"]).optional(),
  OIDC_ALLOW_SIGNUP: bool,

  SMTP_URL: optionalString,
  SMTP_FROM: optionalString,
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

/** Parsed and validated environment. Read lazily so `next build` does not need runtime secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")
      throw new Error(`Invalid environment configuration:\n${issues}`)
    }
    cached = parsed.data
  }
  return cached
}

export function appUrl(): string {
  return env().APP_URL.replace(/\/+$/, "")
}
