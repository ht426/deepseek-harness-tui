/**
 * Markdown → plain text (no styling). Used where a single-line summary is
 * needed. Kept separate from the ink renderer so callers can preview without a
 * React runtime.
 */

import { marked } from 'marked'

/** Render markdown to plain text, one physical line per paragraph/list item. */
export function markdownToText(markdown: string): string {
  const tokens = marked.lexer(markdown)
  const lines: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
      case 'paragraph':
        lines.push(token.text.trim())
        break
      case 'code':
        for (const line of token.text.replace(/\n$/, '').split('\n')) lines.push(line)
        break
      case 'list':
        for (const item of token.items) lines.push(`• ${item.text.trim()}`)
        break
      case 'blockquote':
        lines.push(token.text.trim())
        break
      case 'space':
        if (lines.at(-1) !== '') lines.push('')
        break
      default:
        break
    }
  }
  return lines.join('\n')
}
