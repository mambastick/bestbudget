import { buildApp } from "./api/app"

const port = Number(process.env.PORT ?? 8089)
const host = process.env.HOST ?? "0.0.0.0"

const app = await buildApp()

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
