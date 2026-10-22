import "server-only"
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto"
import { env } from "./env"

/**
 * Symmetric encryption for secrets stored in the database (e.g. the OIDC client secret).
 * AES-256-GCM with a key derived via HKDF from ENCRYPTION_KEY (or BETTER_AUTH_SECRET).
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */

let key: Buffer | undefined

function getKey(): Buffer {
  if (!key) {
    const material = env().ENCRYPTION_KEY ?? env().BETTER_AUTH_SECRET
    key = Buffer.from(hkdfSync("sha256", material, "bestbudget", "settings-encryption-v1", 32))
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported secret format")
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

/** URL-safe random token for invitations. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/** Tokens are stored only as SHA-256 hashes, so a database leak does not expose usable links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}
