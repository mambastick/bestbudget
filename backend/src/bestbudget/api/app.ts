import cors from "@fastify/cors"
import Fastify from "fastify"

import { registerAuthRoutes } from "./routes/auth-routes"
import { registerCalendarRoutes } from "./routes/calendar-routes"

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  })

  await app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  })

  app.get("/health/live", async () => ({
    status: "ok",
    service: "bestbudget-api",
  }))

  app.get("/health/ready", async () => ({
    status: "ready",
    database: process.env.DATABASE_URL ? "configured" : "not_configured",
  }))

  await registerAuthRoutes(app)
  await registerCalendarRoutes(app)

  return app
}
