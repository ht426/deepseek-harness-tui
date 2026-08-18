/**
 * dsh-tui render layer: the ink App that draws the transcript, status bar,
 * input box, and modal overlays from a {@link TuiStore}.
 *
 * Visual language follows Claude Code: borderless, indent + symbol + color
 * driven. `>` is the user prompt, `✻` a collapsed thinking line, `⏺` a tool
 * call with `⎿` indented results and `✓`/timing on completion.
 */

import { Box, Text, Newline } from 'ink'
import { useSyncExternalStore, useState } from 'react'
import { useInput } from 'ink'
import type { TuiStore, TranscriptNode } from '../store.ts'
import { flatRecords } from '../store.ts'
import type { TuiController } from '../controller.ts'
import { Markdown, type MarkdownTheme } from '../markdown.tsx'
import { QuestionModal } from './question-modal.tsx'
import { ApprovalModal } from './approval-modal.tsx'
import { SelectModal } from './select-modal.tsx'
import { StatusBar } from './status-bar.tsx'
import { InputBar } from './input-bar.tsx'
import { Banner } from './banner.tsx'
import { TrajectoryView } from './trajectory.tsx'

export interface AppProps {
  store: TuiStore
  controller: TuiController
  theme: MarkdownTheme
  banner: boolean
}

/** Format a millisecond duration the way Claude Code shows tool timings. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Transcript density: how much tool/thinking detail to show. */
type Density = 'folded' | 'expanded' | 'hidden'

/** Render one transcript node. */
function NodeView({ node, theme, density }: { node: TranscriptNode; theme: MarkdownTheme; density: Density }): React.ReactNode {
  switch (node.kind) {
    case 'user':
      return (
        <Box key={node.key} flexDirection="column">
          <Text color="cyan" bold>{'> '}<Text color="white">{node.text}</Text></Text>
        </Box>
      )
    case 'assistant':
      return (
        <Box key={node.key} flexDirection="column">
          {node.reasoning !== undefined && node.reasoning !== ''
            ? (
                <ThinkingBlock key={`${node.key}:t`} text={node.reasoning} folded={density === 'folded'} />
              )
            : null}
          {node.text !== ''
            ? <Box flexDirection="column"><Markdown text={node.text} theme={theme} /></Box>
            : null}
        </Box>
      )
    case 'tool':
      return <ToolCall key={node.key} node={node} folded={density === 'folded'} />
    case 'context':
      return <ContextBlock key={node.key} text={node.text} folded={density === 'folded'} />
    case 'todo':
      return (
        <Box key={node.key} flexDirection="column">
          {node.todos.map((todo, i) => (
            <Text key={i} color={todo.status === 'completed' ? 'green' : todo.status === 'in_progress' ? 'cyan' : 'gray'}>
              {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '○'} {todo.content}
            </Text>
          ))}
        </Box>
      )
    case 'command':
      return (
        <Box key={node.key} flexDirection="column">
          <Text color="magenta">{node.status === 'error' ? '✗' : node.status === 'running' ? '●' : '✓'} <Text bold>/{node.name}</Text>{node.args !== undefined ? ` ${node.args}` : ''}</Text>
          {node.text !== undefined && node.text !== ''
            ? <Text color="gray">⎿ {node.text}</Text>
            : null}
        </Box>
      )
    case 'notice':
      return (
        <Text key={node.key} color={node.level === 'error' ? 'red' : node.level === 'warn' ? 'yellow' : 'gray'}>
          {node.level === 'error' ? '✗' : '·'} {node.text}
        </Text>
      )
  }
}

/**
 * Collapsed-by-default context-injection line (CLAUDE.md, runtime-context
 * reminders, the skill catalog, …): folded shows one line, expanded the full
 * text. These carry `source.kind !== 'user'` in the event log — same shape
 * as a real user message, just not something the user actually typed — so
 * without this they render as full, unfolded turns ahead of every real
 * question in a fresh session, which reads as a wall of unrelated boilerplate.
 */
function ContextBlock({ text, folded }: { text: string; folded: boolean }): React.ReactNode {
  if (folded) {
    const firstLine = text.split('\n')[0] ?? ''
    const truncated = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
    return <Text color="gray">⎿ context · {truncated}</Text>
  }
  return (
    <Text color="gray">
      ⎿ {text.split('\n').join('\n  ')}
    </Text>
  )
}

/** Collapsed-by-default thinking line: folded shows one line, expanded the full text. */
function ThinkingBlock({ text, folded }: { text: string; folded: boolean }): React.ReactNode {
  if (folded) {
    const firstLine = text.split('\n')[0] ?? ''
    const truncated = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
    return <Text color="gray" italic>✻ thinking · {truncated}</Text>
  }
  return (
    <Text color="gray" italic>
      ✻ {text.split('\n').join('\n  ')}
    </Text>
  )
}

/** A tool call: `⏺ Name(args)` header, `⎿` indented body, `✓`/timing when done. */
function ToolCall({ node, folded }: { node: Extract<TranscriptNode, { kind: 'tool' }>; folded: boolean }): React.ReactNode {
  const running = node.status === 'running'
  const failed = node.finish?.error === true || (node.finish?.exitCode !== undefined && node.finish.exitCode !== 0)
  const color = running ? 'cyan' : failed ? 'red' : 'green'
  const glyph = running ? '⏺' : failed ? '✗' : '✓'
  // One compact status suffix: timing, then exit/signal when the run ended abnormally.
  const suffixes: string[] = []
  if (node.durationMs !== undefined) suffixes.push(fmtDuration(node.durationMs))
  if (node.finish?.signal !== undefined) suffixes.push(`killed: ${node.finish.signal}`)
  else if (node.finish?.exitCode !== undefined && node.finish.exitCode !== 0) suffixes.push(`exit ${node.finish.exitCode}`)
  const suffix = suffixes.length > 0 ? ` ${suffixes.join(' · ')}` : ''
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{glyph}</Text>{' '}
        <Text bold color={running ? 'white' : undefined}>{node.title ?? node.name}</Text>
        {running ? ' …' : ''}
        <Text color="gray">{suffix}</Text>
        {folded && node.body !== undefined && node.body !== ''
          ? <Text color="gray"> ⎿ folded</Text>
          : null}
      </Text>
      {folded
        ? null
        : (
            <>
              {node.description !== undefined
                ? <Text color="gray">{node.description}</Text>
                : null}
              {node.cwd !== undefined
                ? <Text color="gray">  in {node.cwd}</Text>
                : null}
              {node.body !== undefined && node.body !== ''
                ? (
                    <Text color="gray">
                      ⎿ {node.body.replace(/\n$/, '').split('\n').join('\n  ')}
                    </Text>
                  )
                : null}
            </>
          )}
    </Box>
  )
}

/** The root ink App. */
export function App({ store, controller, theme, banner }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [density, setDensity] = useState<'folded' | 'expanded' | 'hidden'>('folded')
  const [input, setInput] = useState('')

  useInput((input, key) => {
    // Ctrl+O cycles transcript density in both views.
    if (input === 'o' && key.ctrl) {
      setDensity(d => d === 'folded' ? 'expanded' : d === 'expanded' ? 'hidden' : 'folded')
      return
    }
    // Ctrl+T toggles chat ↔ trajectory.
    if (input === 't' && key.ctrl) {
      store.setView(snapshot.view === 'trajectory' ? 'chat' : 'trajectory')
      return
    }
    // Trajectory view navigation owns the remaining keys while active.
    if (snapshot.view === 'trajectory') {
      if (key.escape) {
        store.setView('chat')
        return
      }
      if (key.upArrow) { store.moveCursor(-1); return }
      if (key.downArrow) { store.moveCursor(1); return }
      if (key.return) {
        const records = flatRecords(snapshot.trajectory)
        const record = records[snapshot.traj.cursor]
        if (record !== undefined) store.toggleExpanded(record.seq)
        return
      }
      if (input === 't' && !key.ctrl) { store.toggleTimeline(); return }
      return
    }
    if (key.escape) {
      if (snapshot.modal?.kind === 'question') store.rejectQuestion(new Error('cancelled'))
      if (snapshot.modal?.kind === 'approval') store.answerApproval('rejected')
      if (snapshot.modal?.kind === 'select') store.answerSelect(undefined)
    }
  })

  const nodes = density === 'hidden'
    ? snapshot.nodes.filter(n => n.kind === 'user' || n.kind === 'assistant')
    : snapshot.nodes

  const inTrajectory = snapshot.view === 'trajectory'

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {inTrajectory
          ? (
              <TrajectoryView
                trajectory={snapshot.trajectory}
                cursor={snapshot.traj.cursor}
                expanded={snapshot.traj.expanded}
                showTimeline={snapshot.traj.showTimeline}
                onSelect={seq => { store.moveCursor(flatRecords(snapshot.trajectory).findIndex(r => r.seq === seq) - snapshot.traj.cursor) }}
                onToggle={seq => { store.toggleExpanded(seq) }}
              />
            )
          : (
              <>
                {banner && snapshot.nodes.length === 0
                  ? <Banner model={snapshot.model} />
                  : null}
                {nodes.map((node, i) => (
                  <Box key={node.key} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
                    {NodeView({ node, theme, density })}
                  </Box>
                ))}
                {snapshot.status === 'running'
                  ? <Text color="gray">⠋ working…</Text>
                  : null}
                {snapshot.notice !== undefined
                  ? <Text color={snapshot.noticeLevel === 'error' ? 'red' : 'yellow'}>{snapshot.notice}</Text>
                  : null}
              </>
            )}
      </Box>
      {!inTrajectory ? <Newline /> : null}
      {snapshot.modal?.kind === 'question'
        ? <QuestionModal store={store} question={snapshot.modal.question} />
        : null}
      {snapshot.modal?.kind === 'approval'
        ? <ApprovalModal store={store} approval={snapshot.modal.approval} />
        : null}
      {snapshot.modal?.kind === 'select'
        ? <SelectModal store={store} select={snapshot.modal.select} />
        : null}
      {!inTrajectory && snapshot.modal === undefined
        ? <InputBar value={input} onChange={setInput} onSubmit={(line) => { setInput(''); controller.submit(line) }} controller={controller} fileIndex={snapshot.fileIndex} />
        : null}
      <StatusBar snapshot={snapshot} density={density} />
    </Box>
  )
}
