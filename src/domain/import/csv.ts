import { MAX_COLUMNS, MAX_ROWS } from "./types"

export function decodeCsv(bytes: Uint8Array, encoding = "auto"): string {
  let selected = encoding
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) selected = "utf-8"
  if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = "utf-16le"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = "utf-16be"
  try {
    const value = new TextDecoder(selected === "auto" ? "utf-8" : selected, { fatal: true }).decode(bytes)
    for (const char of value) {
      const code = char.charCodeAt(0)
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 0xfffd) throw new Error()
    }
    return value.replace(/^\ufeff/, "")
  } catch {
    throw new Error("Не удалось прочитать текст. Выберите Windows-1251 или правильную кодировку и проверьте заголовки.")
  }
}

/** RFC 4180 quoting, including embedded newlines. Row locators refer to logical records. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false
  const endField = () => {
    row.push(field)
    if (row.length > MAX_COLUMNS) throw new Error(`В файле больше ${MAX_COLUMNS} колонок`)
    field = ""
    closed = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    if (rows.length > MAX_ROWS + 1000) throw new Error(`В файле больше ${MAX_ROWS} строк данных`)
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += c
    } else if (c === delimiter) endField()
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRow()
    } else if (c === '"' && !field && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error("Неверные кавычки CSV. Проверьте разделитель и формат файла.")
      field += c
    }
    if (field.length > 10_000) throw new Error("Слишком длинная ячейка (максимум 10 000 символов)")
  }
  if (quoted) throw new Error("Незакрытые кавычки CSV")
  if (field || row.length || closed) endRow()
  return rows
}

export function detectDelimiter(text: string): string | null {
  const candidates = [";", ",", "\t"].filter((delimiter) => {
    try {
      const rows = parseCsv(text, delimiter)
        .filter((r) => r.some((c) => c.trim()))
        .slice(0, 20)
      const width = rows[0]?.length ?? 0
      return width > 1 && rows.every((r) => r.length === width)
    } catch {
      return false
    }
  })
  return candidates.length === 1 ? candidates[0]! : null
}
