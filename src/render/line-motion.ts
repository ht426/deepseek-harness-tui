/**
 * Cursor/line-motion helpers for the multi-line input buffer, mirroring GNU
 * readline's word/line units (Home/End, Ctrl+A/E/K/U/W, vertical motion).
 */

/** Offset of the start of the line containing `pos`. */
export function lineStartIndex(text: string, pos: number): number {
  const before = text.lastIndexOf('\n', pos - 1)
  return before === -1 ? 0 : before + 1
}

/** Offset of the end of the line containing `pos` (before its trailing `\n`, if any). */
export function lineEndIndex(text: string, pos: number): number {
  const after = text.indexOf('\n', pos)
  return after === -1 ? text.length : after
}

/** Start of the whitespace-delimited word immediately behind `pos` — the unit Ctrl+W kills. */
export function backwardWordBoundary(text: string, pos: number): number {
  let i = pos
  while (i > 0 && /\s/.test(text[i - 1] ?? '')) i--
  while (i > 0 && !/\s/.test(text[i - 1] ?? '')) i--
  return i
}

/** Zero-indexed visual row/column of `offset` within a (possibly multi-line) buffer. */
export function computeRowCol(text: string, offset: number): { row: number; col: number } {
  const upToCursor = text.slice(0, offset)
  const lastNewline = upToCursor.lastIndexOf('\n')
  const row = (upToCursor.match(/\n/g) ?? []).length
  return { row, col: offset - (lastNewline + 1) }
}

/**
 * Move the cursor a visual line up/down, clamping to the target line's
 * length; a no-op at the first/last line (the caller decides what to do
 * with that — e.g. nothing, since this component has no history recall).
 */
export function moveCursorVertically(text: string, cursor: number, direction: -1 | 1): number {
  const { col } = computeRowCol(text, cursor)
  if (direction === -1) {
    const curLineStart = lineStartIndex(text, cursor)
    if (curLineStart === 0) return cursor
    const prevLineEnd = curLineStart - 1
    const prevLineStart = lineStartIndex(text, prevLineEnd)
    return prevLineStart + Math.min(col, prevLineEnd - prevLineStart)
  }
  const curLineEnd = lineEndIndex(text, cursor)
  if (curLineEnd === text.length) return cursor
  const nextLineStart = curLineEnd + 1
  const nextLineEnd = lineEndIndex(text, nextLineStart)
  return nextLineStart + Math.min(col, nextLineEnd - nextLineStart)
}
