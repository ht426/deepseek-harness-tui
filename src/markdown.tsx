/**
 * Markdown → ink element rendering.
 *
 * Parses with `marked` and renders tokens to ink `<Text>`/`<Box>` elements with
 * semantic color props (never raw ANSI, which ink's width measurement and
 * color system would mis-handle).
 */

import { marked } from 'marked'
import type { Token } from 'marked'
import { Text, Box } from 'ink'
import type { ReactNode } from 'react'

/** Color prop strings ink accepts (named chalk colors). */
export type InkColor = 'cyan' | 'green' | 'red' | 'yellow' | 'white' | 'black' | 'gray' | 'magenta' | 'blue'

/** Semantic token styling. */
export interface Style {
  color?: InkColor
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** Theme passed to the renderer (a subset of the full palette, ink-mapped). */
export interface MarkdownTheme {
  text: Style
  muted: Style
  accent: Style
  code: Style
}

export const PLAIN_THEME: MarkdownTheme = {
  text: {},
  muted: { dim: true },
  accent: { color: 'cyan' },
  code: { color: 'yellow' },
}

/** Ink `<Text>` props derived from a {@link Style}. */
function textProps(style: Style): { color?: InkColor; dimColor?: boolean; bold?: boolean; italic?: boolean; underline?: boolean } {
  return {
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.dim === true ? { dimColor: true } : {}),
    ...(style.bold === true ? { bold: true } : {}),
    ...(style.italic === true ? { italic: true } : {}),
    ...(style.underline === true ? { underline: true } : {}),
  }
}

/** Safe token list: marked's `Tokens.Generic` (`type: string`) defeats narrow
 *  discarding of optional `tokens`, so read it structurally. */
function childTokens(token: { tokens?: Token[] }): readonly Token[] {
  return token.tokens ?? []
}

/**
 * Strip a `**` pair that marked could not parse into a `strong` token (unclosed
 * or space-separated). A valid `**bold**` already became a `strong` token, so
 * any `**` still sitting in a `text` token is stray markup and renders as
 * literal asterisks otherwise.
 */
function stripStrayBold(text: string): string {
  return text.replace(/\*\*/g, '')
}

function inline(tokens: readonly Token[] | undefined, theme: MarkdownTheme, keyPrefix: string): ReactNode[] {
  if (tokens === undefined) return []
  const out: ReactNode[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined) continue
    const key = `${keyPrefix}:${i}`
    switch (token.type) {
      case 'text':
      case 'escape':
        out.push(<Text key={key} {...textProps(theme.text)}>{stripStrayBold(token.text)}</Text>)
        break
      case 'strong':
        out.push(<Text key={key} {...textProps(theme.text)} bold>{inline(token.tokens, theme, key)}</Text>)
        break
      case 'em':
        out.push(<Text key={key} {...textProps(theme.text)} italic>{inline(token.tokens, theme, key)}</Text>)
        break
      case 'codespan':
        out.push(<Text key={key} {...textProps(theme.code)}>{token.text}</Text>)
        break
      case 'link':
        out.push(
          <Text key={key} {...textProps(theme.accent)}>
            {inline(token.tokens, theme, key)}
            <Text {...textProps(theme.muted)}> ({token.href})</Text>
          </Text>,
        )
        break
      case 'del':
        out.push(<Text key={key} {...textProps(theme.text)} strikethrough>{inline(token.tokens, theme, key)}</Text>)
        break
      case 'br':
        out.push(<Text key={key}>{'\n'}</Text>)
        break
      default:
        if ('raw' in token && typeof token.raw === 'string') out.push(<Text key={key} {...textProps(theme.text)}>{token.raw}</Text>)
        break
    }
  }
  return out
}

/** Render one block token into ink elements. */
function block(token: Token, theme: MarkdownTheme, key: string): ReactNode {
  switch (token.type) {
    case 'heading':
      return <Text key={key} {...textProps(theme.text)} bold>{inline(token.tokens, theme, key)}</Text>
    case 'paragraph':
      return <Text key={key}>{inline(token.tokens, theme, key)}</Text>
    case 'space':
      return <Text key={key}>{'\n'}</Text>
    case 'code':
      return <Text key={key} {...textProps(theme.code)}>{token.text.replace(/\n$/, '')}</Text>
    case 'blockquote':
      return (
        <Box key={key} flexDirection="column" paddingLeft={1}>
          {childTokens(token).map((t, i) => block(t, theme, `${key}:${i}`))}
        </Box>
      )
    case 'list': {
      const items = token.items.map((item: { tokens: Token[]; text: string }, i: number) => {
        const marker = token.ordered ? `${token.start === '' ? 1 : Number(token.start) + i}. ` : '• '
        // A tight list item's first token is a `text` token whose own `tokens`
        // hold the inline children (bold/code/links); a loose item leads with
        // block tokens. Render inline text inline, blocks as blocks.
        const body = item.tokens.map((t: Token, j: number) => (
          t.type === 'text'
            ? <Text key={`${key}:${i}:${j}`}>{inline(t.tokens, theme, `${key}:${i}:${j}`)}</Text>
            : block(t, theme, `${key}:${i}:${j}`)
        ))
        return (
          <Box key={`${key}:${i}`} flexDirection="row">
            <Text {...textProps(theme.muted)}>{marker}</Text>
            <Box flexDirection="column" flexShrink={1}>{body}</Box>
          </Box>
        )
      })
      return <Box key={key} flexDirection="column">{items}</Box>
    }
    case 'hr':
      return <Text key={key} {...textProps(theme.muted)}>{'─'.repeat(24)}</Text>
    default:
      return 'raw' in token && typeof token.raw === 'string' ? <Text key={key}>{token.raw}</Text> : <Text key={key} />
  }
}

/** Render a markdown string into ink elements. */
export function Markdown({ text, theme = PLAIN_THEME }: { text: string; theme?: MarkdownTheme }): ReactNode {
  const tokens = marked.lexer(text)
  return <>{tokens.map((token, i) => block(token, theme, `md:${i}`))}</>
}
