import { describe, it, expect } from 'vitest'
import { foldTrajectory, TrajectoryFold } from '../src/trajectory.ts'
import { createUserMessage, MessageId, CallId } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function ev<K extends SessionEvent['type']>(type: K, data: Extract<SessionEvent, { type: K }>['data'], seq: number, time: number): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

describe('foldTrajectory', () => {
  it('groups records into turns with boundary times', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 100),
      ev('user/message', createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }), 1, 200),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2, 900),
      ev('turn/start', { turn: 2 }, 3, 1000),
      ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 4, 1100),
    ]
    const t = foldTrajectory(events)
    expect(t.turns).toHaveLength(2)
    expect(t.turns[0]).toMatchObject({ turn: 1, startTime: 100, endTime: 900 })
    expect(t.turns[0]!.records).toHaveLength(1)
    expect(t.turns[0]!.records[0]?.kind).toBe('user')
  })

  it('pairs tool call/result and keeps argsJson', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 0),
      ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }, 1, 10),
      ev('tool/result', {
        turn: 1, step: 1,
        message: { id: MessageId('m'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
      }, 2, 1010),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3, 1020),
    ]
    const t = foldTrajectory(events)
    const tool = t.turns[0]!.records.find(r => r.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool', name: 'bash', status: 'done', argsJson: '{"command":"ls"}', outputText: 'ok', durationMs: 1000,
    })
  })

  it('computes assistant duration from the first same-step record', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 0),
      ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{}' }, 1, 100),
      ev('tool/result', {
        turn: 1, step: 1,
        message: { id: MessageId('m'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
      }, 2, 500),
      ev('assistant/message', {
        turn: 1, step: 1,
        message: { id: MessageId('a'), role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        usage: { inputTokens: 10, outputTokens: 2 },
      }, 3, 700),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4, 700),
    ]
    const t = foldTrajectory(events)
    const assistant = t.turns[0]!.records.find(r => r.kind === 'assistant')
    expect(assistant).toMatchObject({ kind: 'assistant', text: 'done', durationMs: 600 })
  })

  it('keeps standalone commands and todos in betweenTurns', () => {
    const events: SessionEvent[] = [
      ev('command/run', { commandId: CommandId('cmd1'), name: 'help', source: { kind: 'user' } }, 0, 0),
      ev('command/done', { commandId: CommandId('cmd1'), kind: 'success', text: 'commands: /help' }, 1, 10),
      ev('todo/write', { todos: [{ content: 'x', status: 'pending' }] }, 2, 20),
    ]
    const t = foldTrajectory(events)
    expect(t.turns).toHaveLength(0)
    expect(t.betweenTurns.map(r => r.kind)).toEqual(['command', 'todo'])
  })

  it('incremental fold matches one-shot fold', () => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0, 0),
      ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{}' }, 1, 10),
      ev('tool/result', {
        turn: 1, step: 1,
        message: { id: MessageId('m'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
      }, 2, 100),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3, 100),
    ]
    const incremental = new TrajectoryFold()
    for (const event of events) incremental.push(event)
    expect(incremental.value).toEqual(foldTrajectory(events))
  })
})
