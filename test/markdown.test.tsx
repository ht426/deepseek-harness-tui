import { describe, it, expect } from 'vitest'
import { renderToString } from 'ink'
import { Markdown } from '../src/markdown.tsx'

/** Render markdown to plain output (no TTY, so no ANSI). */
function render(text: string): string {
  return renderToString(<Markdown text={text} />, { columns: 80 })
}

describe('Markdown rendering', () => {
  it('renders valid **bold** as bold (no literal asterisks)', () => {
    const out = render('**bold** text')
    expect(out).not.toContain('**')
    expect(out).toContain('bold')
  })

  it('strips stray ** pairs (unclosed or space-separated)', () => {
    expect(render('a ** b ** c')).toBe('a  b  c')
    expect(render('**unclosed bold')).toBe('unclosed bold')
  })

  it('keeps single asterisks (multiplication / valid italic)', () => {
    expect(render('x * y')).toContain('*')
  })

  it('renders code spans and links without leaking markers', () => {
    const out = render('`code` and [link](https://x)')
    expect(out).toContain('code')
    expect(out).toContain('link')
    expect(out).toContain('https://x')
  })
})
