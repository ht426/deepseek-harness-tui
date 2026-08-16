import { describe, it, expect } from 'vitest'
import { renderToString } from 'ink'
import { TrajectoryView } from '../src/render/trajectory.tsx'
import { foldTrajectory } from '../src/trajectory.ts'
import { createUserMessage, MessageId, CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function ev<K extends SessionEvent['type']>(type: K, data: Extract<SessionEvent, { type: K }>['data'], seq: number, time: number): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

describe('TrajectoryView render', () => {
  it('renders turn headers, a tool record, and the overview timeline', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 0),
      ev('user/message', createUserMessage({ content: [{ type: 'text', text: 'do it' }], source: { kind: 'user' } }), 1, 10),
      ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }, 2, 20),
      ev('tool/result', {
        turn: 1, step: 1,
        message: { id: MessageId('m'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'total 8' }] }], source: { kind: 'tool', callId: CallId('c1') } },
      }, 3, 1020),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4, 1030),
    ]
    const trajectory = foldTrajectory(events)
    const out = renderToString(
      <TrajectoryView trajectory={trajectory} cursor={0} expanded={[]} showTimeline onSelect={() => {}} onToggle={() => {}} />,
      { columns: 80 },
    )
    expect(out).toContain('Turn 1')
    expect(out).toContain('overview')
    expect(out).toContain('bash')
    expect(out).toContain('detail')
  })

  it('shows expanded detail for the selected tool', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 0),
      ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }, 1, 10),
      ev('tool/result', {
        turn: 1, step: 1,
        message: { id: MessageId('m'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'total 8' }] }], source: { kind: 'tool', callId: CallId('c1') } },
      }, 2, 1010),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3, 1010),
    ]
    const trajectory = foldTrajectory(events)
    const out = renderToString(
      <TrajectoryView trajectory={trajectory} cursor={1} expanded={[1]} showTimeline={false} onSelect={() => {}} onToggle={() => {}} />,
      { columns: 80 },
    )
    expect(out).toContain('input: {"command":"ls"}')
    expect(out).toContain('output: total 8')
  })

  it('hides the timeline when showTimeline is false', () => {
    const out = renderToString(
      <TrajectoryView trajectory={{ turns: [], betweenTurns: [] }} cursor={0} expanded={[]} showTimeline={false} onSelect={() => {}} onToggle={() => {}} />,
      { columns: 80 },
    )
    expect(out).not.toContain('overview')
    expect(out).toContain('no records yet')
  })
})
