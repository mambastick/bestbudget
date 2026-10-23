import { fileOptionsSchema, MAX_FILE_BYTES, previewInputSchema } from "@/domain/import/types"
import { env } from "@/lib/env"
import { AppError, runAction } from "@/server/errors"
import { describeStatement, readStatement } from "@/server/import/file"
import { actionHousehold } from "@/server/session"
import { assertCan } from "@/server/context"
import { commitImport, commitInputSchema, previewImport } from "@/server/services/imports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** A dedicated route keeps the larger upload limit out of all server actions. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(env().APP_URL).origin)
    return Response.json({ ok: false, error: "Недопустимый источник запроса" }, { status: 403 })
  const result = await runAction(async () => {
    const ctx = await actionHousehold()
    assertCan(ctx, "finance.write")
    const limit = MAX_FILE_BYTES + 128 * 1024
    if (Number(request.headers.get("content-length") ?? 0) > limit) throw new AppError("Файл больше 10 МБ")
    const reader = request.body?.getReader()
    if (!reader) throw new AppError("Выберите файл")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) {
          await reader.cancel()
          throw new AppError("Файл больше 10 МБ")
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    let form: FormData
    try {
      form = await new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData()
    } catch {
      throw new AppError("Некорректная загрузка файла")
    }
    let config: unknown
    try {
      config = JSON.parse(String(form.get("config") ?? "{}"))
    } catch {
      throw new AppError("Некорректная настройка импорта")
    }
    if (form.get("mode") === "commit") return { stage: "committed" as const, ...(await commitImport(ctx, commitInputSchema.parse(config))) }
    const file = form.get("file")
    if (!(file instanceof File) || file.size > MAX_FILE_BYTES) throw new AppError("Выберите файл размером до 10 МБ")
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (form.get("mode") === "preview")
      return { stage: "preview" as const, ...(await previewImport(ctx, bytes, previewInputSchema.parse(config))) }
    const options = fileOptionsSchema.parse(config)
    return { stage: "inspect" as const, ...describeStatement(await readStatement(bytes, options), options) }
  })
  return Response.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } })
}
