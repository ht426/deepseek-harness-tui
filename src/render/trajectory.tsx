/**
 * Trajectory view: a turn-aware event ledger with an ASCII overview timeline
 * and a per-record detail panel. The terminal equivalent of the Web
 * `ui-trajectory` view, driven entirely by the folded {@link Trajectory}.
 */

import { Box, Text } from 'ink'
import { useStdout } from 'ink'
import type { Trajectory, TrajectoryRecord, TrajectoryTurn } from '../trajectory.ts'
import { flatRecords } from '../store.ts'

export interface TrajectoryViewProps {
  trajectory: Trajectory
  cursor: number
  expanded: readonly number[]
  showTimeline: boolean
  onSelect: (seq: number) => void
  onToggle: (seq: number) => void
}

/** Format a millisecond duration. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** One selectable span: absolute start/end times. */
interface Span {
  seq: number
  kind: TrajectoryRecord['kind']
  start: number
  end: number
}

/** Collect every record that has a start time and duration into spans. */
function spansOf(t: Trajectory): Span[] {
  const spans: Span[] = []
  for (const record of flatRecords(t)) {
    const start = record.time
    let end = start
    if (record.kind === 'tool' && record.durationMs !== undefined) end = start + record.durationMs
    else if (record.kind === 'assistant' && record.durationMs !== undefined) end = start + record.durationMs
    else continue // user/command/todo/context have no duration; skip on the timeline
    spans.push({ seq: record.seq, kind: record.kind, start, end })
  }
  return spans
}

/** A color per record kind, for the timeline blocks. */
function kindColor(kind: TrajectoryRecord['kind']): 'cyan' | 'green' | 'yellow' | 'magenta' | 'gray' {
  switch (kind) {
    case 'tool': return 'green'
    case 'assistant': return 'cyan'
    case 'user': return 'yellow'
    case 'command': return 'magenta'
    default: return 'gray'
  }
}

/** Render the ASCII overview timeline: each span is a block, gaps are dots. */
function Timeline({ trajectory, width }: { trajectory: Trajectory; width: number }): React.ReactNode {
  const spans = spansOf(trajectory)
  if (spans.length === 0) {
    return <Text color="gray">no timed records yet</Text>
  }
  const minStart = Math.min(...spans.map(s => s.start))
  const maxEnd = Math.max(...spans.map(s => s.end))
  const total = Math.max(1, maxEnd - minStart)
  // One cell per column, filled by the first span covering it.
  const cells: React.ReactNode[] = []
  const usable = Math.max(10, width - 2)
  for (let col = 0; col < usable; col += 1) {
    const t0 = minStart + (col / usable) * total
    const t1 = minStart + ((col + 1) / usable) * total
    const cover = spans.find(s => s.start < t1 && s.end > t0)
    if (cover === undefined) {
      cells.push(<Text key={col} color="gray">·</Text>)
    } else {
      cells.push(<Text key={col} color={kindColor(cover.kind)}>▓</Text>)
    }
  }
  return (
    <Box flexDirection="column">
      <Text color="gray">overview</Text>
      <Box flexDirection="row">
        <Text color="gray">├</Text>
        {cells}
        <Text color="gray">┤</Text>
      </Box>
      <Text color="gray">▍ tool · assistant · user · command</Text>
    </Box>
  )
}

/** One ledger row: index, glyph, name, timing, token, expandable detail. */
function RecordRow({ record, index, cursor, expanded, onSelect, onToggle }: {
  record: TrajectoryRecord
  index: number
  cursor: number
  expanded: readonly number[]
  onSelect: (seq: number) => void
  onToggle: (seq: number) => void
}): React.ReactNode {
  const isCursor = index === cursor
  const isExpanded = expanded.includes(record.seq)
  const cursorColor = isCursor ? 'black' : undefined
  const cursorBg = isCursor ? 'white' : undefined
  const label = recordLabel(record)
  const timing = recordTiming(record)
  return (
    <Box flexDirection="column">
      <Text backgroundColor={cursorBg} color={cursorColor}>
        {isCursor ? '›' : ' '} {label}{timing !== undefined ? <Text color="gray"> {timing}</Text> : null}
      </Text>
      {isExpanded
        ? <RecordDetail record={record} />
        : null}
      {/* Click/enter is handled by the parent; the row itself is selectable by cursor. */}
    </Box>
  )
}

/** Compact one-line label for a record. */
function recordLabel(record: TrajectoryRecord): string {
  switch (record.kind) {
    case 'user': return `> ${record.text}`
    case 'assistant': return `● ${record.text.slice(0, 80)}${record.text.length > 80 ? '…' : ''}`
    case 'tool': return `${record.status === 'running' ? '⏺' : record.error === true ? '✗' : '✓'} ${record.name} ${record.argsJson}`
    case 'command': return `/${record.name}${record.args !== undefined ? ` ${record.args}` : ''}`
    case 'todo': return `todo (${record.todos.length})`
    case 'context': return `⌁ ${record.text.slice(0, 60)}`
  }
}

/** Timing/usage suffix for a record. */
function recordTiming(record: TrajectoryRecord): string | undefined {
  if (record.kind === 'tool') {
    return record.durationMs !== undefined ? fmtDuration(record.durationMs) : undefined
  }
  if (record.kind === 'assistant') {
    const parts: string[] = []
    if (record.durationMs !== undefined) parts.push(fmtDuration(record.durationMs))
    if (record.usage !== undefined) parts.push(`${record.usage.inputTokens + (record.usage.cacheReadTokens ?? 0)}↓ ${record.usage.outputTokens}↑`)
    return parts.length > 0 ? parts.join(' · ') : undefined
  }
  return undefined
}

/** Expanded detail: input (args) / output (result), plus timing and usage. */
function RecordDetail({ record }: { record: TrajectoryRecord }): React.ReactNode {
  const lines: React.ReactNode[] = []
  if (record.kind === 'tool') {
    lines.push(<Text key="args" color="gray">  input: {record.argsJson}</Text>)
    if (record.outputText !== undefined && record.outputText !== '') {
      lines.push(<Text key="out" color="gray">  output: {record.outputText.split('\n').join('\n  ')}</Text>)
    }
    if (record.exitCode !== undefined) lines.push(<Text key="exit" color="gray">  exit {record.exitCode}</Text>)
    if (record.signal !== undefined) lines.push(<Text key="sig" color="gray">  killed: {record.signal}</Text>)
  } else if (record.kind === 'assistant') {
    if (record.reasoning !== undefined && record.reasoning !== '') {
      lines.push(<Text key="reasoning" color="gray" italic>  ✻ {record.reasoning.split('\n').join('\n  ')}</Text>)
    }
    if (record.usage !== undefined) {
      lines.push(<Text key="usage" color="gray">  tokens {record.usage.inputTokens + (record.usage.cacheReadTokens ?? 0)}↓ {record.usage.outputTokens}↑</Text>)
    }
  } else if (record.kind === 'user' || record.kind === 'context') {
    lines.push(<Text key="body" color="gray">  {record.text.split('\n').join('\n  ')}</Text>)
  }
  return <Box flexDirection="column">{lines}</Box>
}

/** A turn boundary separator. */
function TurnHeader({ turn }: { turn: TrajectoryTurn }): React.ReactNode {
  const duration = turn.endTime !== undefined ? fmtDuration(turn.endTime - turn.startTime) : 'running'
  return (
    <Text color="cyan" bold>
      ━━ Turn {turn.turn} · {duration} ━━
    </Text>
  )
}

/** The full trajectory view. */
export function TrajectoryView({ trajectory, cursor, expanded, showTimeline, onSelect, onToggle }: TrajectoryViewProps): React.ReactNode {
  const { stdout } = useStdout()
  const width = stdout.columns ?? 80
  const records = flatRecords(trajectory)

  // Build the ledger as interleaved turn headers + rows, with a global index.
  const rows: React.ReactNode[] = []
  let index = 0
  for (const record of trajectory.betweenTurns) {
    rows.push(
      <RecordRow key={record.seq} record={record} index={index} cursor={cursor} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />,
    )
    index += 1
  }
  for (const turn of trajectory.turns) {
    rows.push(<TurnHeader key={`turn:${turn.turn}`} turn={turn} />)
    for (const record of turn.records) {
      rows.push(
        <RecordRow key={record.seq} record={record} index={index} cursor={cursor} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />,
      )
      index += 1
    }
  }

  const selected = records[cursor]

  return (
    <Box flexDirection="column">
      {showTimeline ? <Timeline trajectory={trajectory} width={width} /> : null}
      <Box flexDirection="column" marginTop={1}>
        {rows.length > 0 ? rows : <Text color="gray">no records yet</Text>}
      </Box>
      {selected !== undefined
        ? (
            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
              <Text color="cyan" bold>detail</Text>
              <RecordDetail record={selected} />
            </Box>
          )
        : null}
    </Box>
  )
}
