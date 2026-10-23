import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const isDev = process.env.NODE_ENV !== "production"

// Next.js and the early PWA install capture use inline bootstrap scripts, so 'unsafe-inline' is required for scripts without a nonce setup.
// Everything else is restricted to the app's own origin; there are no third-party resources.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "worker-src 'self'",
].join("; ")

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Do not write AGENTS.md into the repository when `next dev` runs under a coding agent.
  agentRules: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ]
  },
}

export default createNextIntlPlugin()(nextConfig)
