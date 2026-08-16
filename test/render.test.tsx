import { describe, it, expect } from 'vitest'
import { renderToString } from 'ink'
import { TuiStore } from '../src/store.ts'
import { App } from '../src/render/app.tsx'
import type { TuiController } from '../src/controller.ts'
import type { MarkdownTheme } from '../src/markdown.tsx'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const THEME: MarkdownTheme = { text: {}, muted: { dim: true }, accent: { color: 'cyan' }, code: { color: 'yellow' } }

/** A no-op controller; render smoke never invokes host actions. */
const controller: TuiController = {
  submit: () => {},
  answerQuestion: () => {},
  rejectQuestion: () => {},
  answerApproval: () => {},
  quit: () => {},
  refreshSessions: () => {},
  switchSession: () => {},
  listCommands: () => [],
}

function userEvent(text: string, seq: number): SessionEvent {
  return { type: 'user/message', seq, time: seq, data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }) } as SessionEvent
}

function render(store: TuiStore): string {
  return renderToString(<App store={store} controller={controller} theme={THEME} banner />, { columns: 80 })
}

describe('App render', () => {
  it('renders the banner on an empty session', () => {
    const store = new TuiStore()
    store.setStatus('idle')
    store.setModel({ provider: 'p', model: 'm' })
    const out = render(store)
    expect(out).toContain('DeepSeek Harness')
    expect(out).toContain('/help')
    expect(out).toContain('idle')
  })

  it('renders a user message and assistant markdown', () => {
    const store = new TuiStore()
    store.setStatus('idle')
    store.pushEvent(userEvent('hello world', 0))
    store.pushEvent({
      type: 'assistant/message', seq: 1, time: 1,
      data: {
        turn: 1, step: 1,
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '**bold** reply' }], source: { kind: 'model', provider: 'p', model: 'm' } },
      },
    } as SessionEvent)
    const out = render(store)
    expect(out).toContain('hello world')
    expect(out).toContain('reply')
    // The `>` prompt marks the user line (Claude Code style — no "assistant" label).
    expect(out).toContain('>')
  })

  it('renders the question modal when one is pending', () => {
    const store = new TuiStore()
    store.setStatus('idle')
    void store.ask({ questions: [{ id: 'q1', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }] })
    const out = render(store)
    expect(out).toContain('Proceed?')
    expect(out).toContain('Yes')
  })

  it('renders the approval modal when one is pending', () => {
    const store = new TuiStore()
    store.setStatus('idle')
    void store.approve('bash', 'unsafe command')
    const out = render(store)
    expect(out).toContain('approval required')
    expect(out).toContain('bash')
  })

  it('renders the select modal with the current value marked', () => {
    const store = new TuiStore()
    store.setStatus('idle')
    void store.select('permission preset', [
      { value: 'workspace-write', label: 'workspace-write' },
      { value: 'danger-full-access', label: 'danger-full-access' },
    ], 'workspace-write')
    const out = render(store)
    expect(out).toContain('permission preset')
    expect(out).toContain('workspace-write')
    expect(out).toContain('(current)')
  })
})
