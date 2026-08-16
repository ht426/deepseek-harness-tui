import { describe, it, expect } from 'vitest'
import { Transcript, type ToolPresenter } from '../src/transcript.ts'
import { createUserMessage, MessageId, CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'

/** Build a synthetic session event for folding tests. */
function event<K extends SessionEvent['type']>(type: K, data: Extract<SessionEvent, { type: K }>['data'], seq: number, time = seq): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

function userText(text: string, seq: number): SessionEvent {
  return event('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), seq)
}

const noPresenter: ToolPresenter = {
  presentCall: () => undefined,
  presentResult: () => undefined,
}

describe('Transcript', () => {
  it('folds user and assistant messages in order', () => {
    const t = new Transcript(noPresenter)
    t.push(userText('hello', 0))
    t.push(event('assistant/message', {
      turn: 1, step: 1,
      message: { id: MessageId('m1'), role: 'assistant', content: [{ type: 'text', text: 'hi there' }], source: { kind: 'model', provider: 'p', model: 'm' } },
      usage: { inputTokens: 10, outputTokens: 4 },
    }, 1))
    const nodes = t.list
    expect(nodes.map(n => n.kind)).toEqual(['user', 'assistant'])
    expect(nodes[0]).toMatchObject({ kind: 'user', text: 'hello' })
    expect(nodes[1]).toMatchObject({ kind: 'assistant', text: 'hi there' })
  })

  it('separates reasoning into the assistant node', () => {
    const t = new Transcript(noPresenter)
    t.push(event('assistant/message', {
      turn: 1, step: 1,
      message: {
        id: MessageId('m1'), role: 'assistant',
        content: [{ type: 'reasoning', text: 'let me think' }, { type: 'text', text: 'answer' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 0))
    const node = t.list[0]
    expect(node?.kind).toBe('assistant')
    if (node?.kind === 'assistant') {
      expect(node.reasoning).toBe('let me think')
      expect(node.text).toBe('answer')
    }
  })

  it('streams chunks into one assistant node then finalizes with the message', () => {
    const t = new Transcript(noPresenter)
    t.push(event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } }, 0))
    t.push(event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } }, 1))
    expect(t.list).toHaveLength(1)
    expect(t.list[0]?.kind).toBe('assistant')
    if (t.list[0]?.kind === 'assistant') expect(t.list[0].text).toBe('hello')
    t.push(event('assistant/message', {
      turn: 1, step: 1,
      message: { id: MessageId('m1'), role: 'assistant', content: [{ type: 'text', text: 'hello world' }], source: { kind: 'model', provider: 'p', model: 'm' } },
    }, 2))
    expect(t.list).toHaveLength(1)
    if (t.list[0]?.kind === 'assistant') expect(t.list[0].text).toBe('hello world')
  })

  it('pairs tool call with result by callId', () => {
    const t = new Transcript(noPresenter)
    t.push(event('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }, 0))
    expect(t.list[0]).toMatchObject({ kind: 'tool', status: 'running' })
    t.push(event('tool/result', {
      turn: 1, step: 1,
      message: { id: MessageId('m2'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
    }, 1))
    expect(t.list).toHaveLength(1)
    expect(t.list[0]).toMatchObject({ kind: 'tool', status: 'done', body: 'ok' })
  })

  it('renders injected context distinctly from user messages', () => {
    const t = new Transcript(noPresenter)
    t.push(event('user/message', createUserMessage({
      content: [{ type: 'text', text: 'system reminder' }],
      source: { kind: 'plugin', plugin: 'ctx' },
    }), 0))
    expect(t.list[0]?.kind).toBe('context')
  })

  it('turns todo/write into a todo node and keeps the latest', () => {
    const t = new Transcript(noPresenter)
    t.push(event('todo/write', { todos: [{ content: 'a', status: 'pending' }] }, 0))
    expect(t.list[0]?.kind).toBe('todo')
  })

  it('records non-completed turn endings as notices', () => {
    const t = new Transcript(noPresenter)
    t.push(event('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 0))
    expect(t.list[0]).toMatchObject({ kind: 'notice', level: 'warn' })
    const t2 = new Transcript(noPresenter)
    t2.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 0))
    expect(t2.list).toHaveLength(0)
  })

  it('reports terminal view exit codes through the presenter', () => {
    const presenter: ToolPresenter = {
      presentCall: (name, argsJson) => {
        if (name === 'bash') return { card: 'terminal', title: 'ls' } satisfies ToolCallView
        return undefined
      },
      presentResult: () => ({ card: 'terminal', output: 'ok', exitCode: 3 }) satisfies ToolResultView,
    }
    const t = new Transcript(presenter)
    t.push(event('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{}' }, 0))
    t.push(event('tool/result', {
      turn: 1, step: 1,
      message: { id: MessageId('m2'), role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
    }, 1))
    expect(t.list[0]).toMatchObject({ kind: 'tool', title: 'ls', finish: { exitCode: 3 } })
  })
})
