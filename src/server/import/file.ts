import "server-only"
import { Unzip, UnzipInflate, zipSync } from "fflate"
import readXlsxFile from "read-excel-file/node"
import { decodeCsv, detectDelimiter, parseCsv } from "@/domain/import/csv"
import { cellText, type StatementCell } from "@/domain/import/normalize"
import { detectProfile, profileMapping } from "@/domain/import/profiles"
import { MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS, type FileOptions } from "@/domain/import/types"
import { AppError } from "@/server/errors"

const MAX_UNPACKED = 40 * 1024 * 1024
const MAX_ENTRIES = 1000

/** Bounded streaming inflation checks actual output bytes, including misleading ZIP headers. */
export function inspectXlsx(bytes: Uint8Array): Uint8Array {
  let total = 0,
    entries = 0,
    completed = 0,
    expandedCells = 0,
    expandedRows = 0
  let failure: AppError | undefined
  const reject = (message: string) => {
    failure ??= new AppError(message)
  }
  const names = new Set<string>()
  const checkedXml: Record<string, Uint8Array> = Object.create(null)
  const unzip = new Unzip((file) => {
    if (++entries > MAX_ENTRIES || (file.originalSize ?? 0) > MAX_UNPACKED) {
      reject("XLSX превышает лимит распаковки (40 МБ / 1000 файлов)")
      return
    }
    if (names.has(file.name) || /(^\/|\.\.|\\)/.test(file.name)) {
      reject("Некорректные пути в XLSX")
      return
    }
    names.add(file.name)
    if (/vba|externalLinks|embeddings|activeX/i.test(file.name)) {
      reject("Макросы, вложения и внешние ссылки XLSX не поддерживаются. Сохраните значения в новую книгу.")
      return
    }
    const chunks: Uint8Array[] = []
    file.ondata = (error, data, final) => {
      if (error) {
        reject("Повреждённый XLSX")
        return
      }
      if (failure) return
      total += data.length
      if (total > MAX_UNPACKED) {
        file.terminate()
        reject("XLSX превышает лимит распаковки (40 МБ)")
        return
      }
      if (/\.(xml|rels)$/i.test(file.name)) chunks.push(data)
      if (final) {
        completed++
        if (!chunks.length) return
        const content = Buffer.concat(chunks)
        let xml: string
        try {
          xml = decodeCsv(content)
        } catch {
          reject("Неподдерживаемая кодировка XML внутри XLSX")
          return
        }
        checkedXml[file.name] = content
        if (/<(?:\w+:)?(?:f|formula)\b|<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["'](?!Internal["'])|macroEnabled/i.test(xml)) {
          reject("Формулы, макросы и внешние ссылки XLSX не поддерживаются. Сохраните только значения.")
          return
        }
        if (file.name === "xl/workbook.xml" && [...xml.matchAll(/<(?:\w+:)?sheet\b/g)].length > 100) {
          reject("В книге больше 100 листов")
          return
        }
        if (/worksheets\/.*\.xml$/i.test(file.name)) {
          let maxRow = 0,
            maxColumn = 0
          for (const match of xml.matchAll(/\br\s*=\s*["']([A-Za-z]+)(\d+)["']/g)) {
            let column = 0
            for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64
            if (column > MAX_COLUMNS || Number(match[2]) > MAX_ROWS + 1000) {
              reject("XLSX превышает лимит строк или колонок")
              return
            }
            maxColumn = Math.max(maxColumn, column)
            maxRow = Math.max(maxRow, Number(match[2]))
          }
          for (const match of xml.matchAll(/<(?:\w+:)?row\b[^>]*\br\s*=\s*["'](\d+)["']/g)) {
            if (Number(match[1]) > MAX_ROWS + 1000) {
              reject("XLSX превышает лимит строк")
              return
            }
            maxRow = Math.max(maxRow, Number(match[1]))
          }
          expandedCells += maxRow * Math.max(maxColumn, 1)
          expandedRows += maxRow
          if (expandedCells > (MAX_ROWS + 1000) * MAX_COLUMNS || expandedRows > MAX_ROWS + 1000) {
            reject("Слишком большая разреженная книга XLSX. Оставьте нужный лист и удалите пустые области.")
            return
          }
          if ([...xml.matchAll(/<(?:\w+:)?row\b/g)].length > MAX_ROWS + 1000) {
            reject("Слишком много строк XLSX")
            return
          }
        }
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // Small compressed chunks bound the allocation inside the streaming inflater as well.
  for (let offset = 0; offset < bytes.length; offset += 256) {
    unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length)
    if (failure) throw failure
  }
  if (!names.has("xl/workbook.xml") || !names.has("[Content_Types].xml") || completed !== entries)
    throw new AppError("Файл ZIP не является корректной книгой XLSX")
  // Read only the checked local entries, avoiding different interpretations of a hostile central directory.
  return zipSync(checkedXml, { level: 0 })
}

export async function readStatement(bytes: Uint8Array, options: FileOptions) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new AppError("Выберите непустой файл размером до 10 МБ")
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    throw new AppError("Старый формат XLS не поддерживается: сохраните как XLSX/CSV")
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-")
    throw new AppError("PDF пока не поддерживается. Выгрузите XLSX/CSV или перенесите данные в шаблон BestBudget.")
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const checked = inspectXlsx(bytes)
      const sheets = await readXlsxFile(Buffer.from(checked), { trim: false, parseNumber: (number) => ({ number }) })
      if (sheets.length > 100) throw new AppError("В книге больше 100 листов")
      if (sheets.some((s) => s.sheet.length > 100)) throw new AppError("Слишком длинное название листа XLSX")
      const data = sheets[options.sheet]
      if (!data) throw new AppError("Выберите существующий лист")
      const rows: StatementCell[][] = data.data.map((row) =>
        row.map((cell) => {
          if (cell instanceof Date) return { date: cell.toISOString().replace(/\.000Z$/, "") }
          if (typeof cell === "object" && cell !== null && "number" in cell) return cell
          return cell === null ? "" : String(cell)
        }),
      )
      validateRows(rows, options)
      return { kind: "xlsx" as const, sheets: sheets.map((s) => s.sheet), rows, delimiter: null }
    }
    const text = decodeCsv(bytes, options.encoding)
    const delimiter = options.delimiter === "auto" ? detectDelimiter(text) : options.delimiter
    if (!delimiter) throw new AppError("Не удалось однозначно определить разделитель. Выберите его вручную.")
    const rows = parseCsv(text, delimiter)
    validateRows(rows, options)
    return { kind: "csv" as const, sheets: ["CSV"], rows, delimiter }
  } catch (error) {
    if (error instanceof AppError) throw error
    // Parser exceptions can contain a source value; only our own CSV errors are exposed.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b)
      throw new AppError("Не удалось прочитать XLSX. Проверьте книгу и сохраните только значения.")
    throw new AppError(error instanceof Error ? error.message : "Не удалось прочитать CSV")
  }
}

function validateRows(rows: StatementCell[][], options: FileOptions) {
  if (rows.length - options.headerRow > MAX_ROWS) throw new AppError(`Не более ${MAX_ROWS} строк данных`)
  if (rows.some((r) => r.length > MAX_COLUMNS || r.some((c) => cellText(c).length > 10_000)))
    throw new AppError("Слишком много колонок или слишком длинная ячейка")
  if (!rows[options.headerRow - 1]) throw new AppError("Строка заголовков не найдена")
  let bytes = 0
  for (const row of rows)
    for (const cell of row) {
      bytes += Buffer.byteLength(cellText(cell), "utf8")
      if (bytes > MAX_UNPACKED) throw new AppError("Значения ячеек после разворачивания превышают 40 МБ")
    }
}

export function describeStatement(statement: Awaited<ReturnType<typeof readStatement>>, options: FileOptions) {
  const headers = statement.rows[options.headerRow - 1]!.map(cellText)
  let profile = detectProfile(headers)
  let mapping
  try {
    mapping = profileMapping(profile, headers)
  } catch {
    profile = "custom"
    mapping = profileMapping(profile, headers)
  }
  if (profile === "custom" && statement.kind === "xlsx") mapping.decimal = "."
  const columnValues = headers.map((_, index) =>
    [
      ...new Set(
        statement.rows
          .slice(options.headerRow)
          .map((r) => cellText(r[index]))
          .filter(Boolean),
      ),
    ].slice(0, 100),
  )
  return {
    kind: statement.kind,
    sheets: statement.sheets,
    delimiter: statement.delimiter,
    headers,
    profile,
    mapping,
    columnValues,
    sample: statement.rows.slice(options.headerRow, options.headerRow + 5).map((r) => r.map(cellText)),
    rowCount: statement.rows.length - options.headerRow,
  }
}
