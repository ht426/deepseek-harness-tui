/**
 * Status bar: a single muted bottom line — model, session, status, token usage.
 * Claude Code keeps this minimal; one line, no border.
 */

import { Text } from 'ink'
import type { TuiSnapshot } from '../store.ts'

/** Format a token count compactly (1.2k, 3.4M). */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function StatusBar({ snapshot, density }: { snapshot: TuiSnapshot; density?: 'folded' | 'expanded' | 'hidden' }): React.ReactNode {
  const last = snapshot.nodes.at(-1)
  const lastUsage = last !== undefined && last.kind === 'assistant' ? last.usage : undefined
  const running = snapshot.status === 'running'
  const statusText = snapshot.status === 'booting' ? 'booting' : running ? '⠋ working' : '✓ idle'
  const model = snapshot.model !== undefined ? `${snapshot.model.provider}/${snapshot.model.model}` : '—'
  const session = snapshot.sessionId !== undefined ? snapshot.sessionId.slice(-12) : 'new'
  const parts: string[] = [model, session]

  // Token accounting for the latest assistant message: input (uncached +
  // cache hits) vs output, with the cache-hit split called out so the two
  // costs are readable rather than one opaque number.
  if (lastUsage !== undefined) {
    const uncached = lastUsage.inputTokens
    const cacheHit = lastUsage.cacheReadTokens ?? 0
    const inputTotal = uncached + cacheHit
    const output = lastUsage.outputTokens
    const cachePart = cacheHit > 0
      ? ` (cache ${fmt(cacheHit)})`
      : ''
    parts.push(`tokens ${fmt(inputTotal)} in${cachePart} · ${fmt(output)} out`)
  }

  if (snapshot.todos.length > 0) {
    parts.push(`${snapshot.todos.filter(t => t.status === 'completed').length}/${snapshot.todos.length} todo`)
  }

  return (
    <Text color="gray">
      <Text color={running ? 'cyan' : 'green'}>{statusText}</Text>
      <Text color="cyan">{snapshot.view === 'trajectory' ? ' [trajectory]' : ''}</Text>
      {density !== undefined
        ? <Text color="gray">{density === 'folded' ? ' [folded]' : density === 'expanded' ? ' [expanded]' : ' [hidden]'}</Text>
        : null}
      {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
    </Text>
  )
}
