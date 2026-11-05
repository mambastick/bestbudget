"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "motion/react"

const FRAME_MS = 40
const MIN_CHARS = 2
/** The share of the backlog revealed per frame: bursts drain quickly, a slow provider still reads evenly. */
const BACKLOG_SHARE = 8

function nextLength(current: number, text: string) {
  const next = Math.min(text.length, current + Math.max(MIN_CHARS, Math.ceil((text.length - current) / BACKLOG_SHARE)))
  const high = text.charCodeAt(next - 1)
  return high >= 0xd800 && high <= 0xdbff ? next + 1 : next
}

/** Reveals streamed text gradually. Text that was complete on mount is returned as is. */
export function useSmoothText(text: string, streaming: boolean) {
  const reduced = useReducedMotion()
  const [length, setLength] = useState(streaming ? 0 : text.length)
  useEffect(() => {
    if (reduced || length >= text.length) return
    const timer = setTimeout(() => setLength((current) => nextLength(current, text)), FRAME_MS)
    return () => clearTimeout(timer)
  }, [reduced, length, text])
  return reduced ? text : text.slice(0, length)
}
