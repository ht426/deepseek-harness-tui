/**
 * Status bar: a single muted bottom line — model, session, status, token usage.
 * Claude Code keeps this minimal; one line, no border.
 */

import { Text } from 'ink'
import type { TuiSnapshot } from '../store.ts'
import { buildStatsLine, buildContextLine } from '../statsFormat.ts'

export function StatusBar({ snapshot, density }: { snapshot: TuiSnapshot; density?: 'folded' | 'expanded' | 'hidden' }): React.ReactNode {
  const running = snapshot.status === 'running'
  const statusText = snapshot.status === 'booting' ? 'booting' : running ? '⠋ working' : '✓ idle'
  const model = snapshot.model !== undefined
    ? `${snapshot.model.provider}/${snapshot.model.model}${snapshot.model.reasoningEffort !== undefined ? ` · ${snapshot.model.reasoningEffort}` : ''}`
    : '—'
  const session = snapshot.sessionId !== undefined ? snapshot.sessionId.slice(-12) : 'new'
  const parts: string[] = [model, session]

  if (snapshot.todos.length > 0) {
    parts.push(`${snapshot.todos.filter(t => t.status === 'completed').length}/${snapshot.todos.length} todo`)
  }

  // Whole-log turn/step counts, LLM/TTFT/decode timing, cache hit rate, and
  // billed tokens — mirrors @tomowang/dsh-tui's stats line field-for-field.
  const statsLine = buildStatsLine(snapshot.stats.sessionStats, snapshot.stats.tokenUsage)
  const contextLine = buildContextLine(snapshot.stats.contextPressure)

  return (
    <>
      <Text color="gray">
        <Text color={running ? 'cyan' : 'green'}>{statusText}</Text>
        <Text color="cyan">{snapshot.view === 'trajectory' ? ' [trajectory]' : ''}</Text>
        {density !== undefined
          ? <Text color="gray">{density === 'folded' ? ' [folded]' : density === 'expanded' ? ' [expanded]' : ' [hidden]'}</Text>
          : null}
        {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
      </Text>
      {statsLine !== '' || contextLine !== ''
        ? (
          <Text color="gray" dimColor>
            {statsLine}
            {statsLine !== '' && contextLine !== '' ? '| ' : ''}
            {contextLine}
          </Text>
        )
        : null}
    </>
  )
}
