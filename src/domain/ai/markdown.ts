const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const WORD = "\\p{L}\\p{N}"

function tableCells(line: string) {
  return line.trim().replace(/^\||\|$/g, "").split("|").length
}

/** A table only renders once its delimiter row is complete, so its first lines must wait instead of showing raw pipes. */
function holdBackUnfinishedTable(text: string) {
  const lines = text.trimEnd().split("\n")
  let start = lines.length
  while (start > 0 && lines[start - 1]!.trimStart().startsWith("|")) start--
  if (start === lines.length) return text
  const [header, delimiter] = lines.slice(start)
  const delimiterFinished = lines.length - start > 2 || text.endsWith("\n")
  if (delimiter && delimiterFinished && DELIMITER_ROW.test(delimiter) && tableCells(delimiter) === tableCells(header!)) return text
  return lines.slice(0, start).join("\n").trimEnd()
}

function insideCodeFence(lines: string[]) {
  return lines.filter((line) => /^\s*(```|~~~)/.test(line)).length % 2 === 1
}

/** Blank out code spans and escapes while keeping offsets, so their characters are not read as markers. */
function maskLiterals(line: string) {
  return line
    .replace(/\\./g, (match) => " ".repeat(match.length))
    .replace(/`[^`]*`/g, (match) => " ".repeat(match.length))
}

/** Close or drop what the last line left open: without this `**` stays on screen as raw text. */
function closeLastLine(line: string) {
  if (/^\s*([*_-])\s*(\1\s*){2,}$/.test(line)) return line
  let repaired = line
    .replace(/!?\[([^\]]*)\]\([^)]*$/, "$1")
    .replace(/!?\[([^\]]*)$/, "$1")
    .replace(/<\/?[a-zA-Z][^>]*$/, "")
  const tick = maskLiterals(repaired).lastIndexOf("`")
  if (tick >= 0) repaired = repaired.slice(tick + 1).trim() ? `${repaired}\`` : repaired.slice(0, tick)
  const masked = maskLiterals(repaired)
  const open: { marker: string; at: number }[] = []
  for (const marker of ["**", "__", "~~"]) {
    const positions = [...masked.matchAll(new RegExp(marker.replace(/\*/g, "\\*"), "g"))].map((match) => match.index)
    if (positions.length % 2) open.push({ marker, at: positions.at(-1)! })
  }
  for (const marker of ["*", "_"]) {
    const m = marker === "*" ? "\\*" : "_"
    const openers = [...masked.matchAll(new RegExp(`(?<![${WORD}${m}])${m}(?![\\s${m}])`, "gu"))]
    const closers = masked.match(new RegExp(`(?<=[^\\s${m}])${m}(?![${WORD}${m}])`, "gu")) ?? []
    if (openers.length > closers.length) open.push({ marker, at: openers.at(-1)!.index })
  }
  if (!open.length) return repaired
  open.sort((a, b) => b.at - a.at)
  let closing = ""
  for (const { marker, at } of open) {
    if (repaired.slice(at + marker.length).replace(/[*_~\s]/g, "")) closing += marker
    else repaired = repaired.slice(0, at) + repaired.slice(at + marker.length)
  }
  return closing ? repaired.trimEnd() + closing : repaired.trimEnd()
}

/**
 * Text cut off at an arbitrary character, whether still streaming or stopped by a limit, is not valid
 * markdown yet. Repair only the unfinished tail so that the reader never sees raw markers.
 */
export function repairMarkdownTail(text: string, { streaming }: { streaming: boolean }) {
  const held = streaming ? holdBackUnfinishedTable(text) : text
  const lines = held.split("\n")
  if (insideCodeFence(lines)) return held
  lines[lines.length - 1] = closeLastLine(lines.at(-1)!)
  return lines.join("\n")
}
