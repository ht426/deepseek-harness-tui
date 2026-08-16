import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apply, name, inject } from '../src/host.tsx'

/**
 * Full-path host wiring smoke: the fake Context implements every seam the
 * plugin touches (including the TTY-only paths and the async boot), so the
 * apply body runs to completion and registers every TUI command. ink's render
 * is mocked out — the component tree itself is covered by render.test.tsx.
 */

// Mock ink so the TTY guard passes without a real terminal.
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    unmount: vi.fn(),
    waitUntilExit: vi.fn(() => new Promise<void>(() => {})),
  })),
}))

interface FakeAgent {
  id: string
  session: { events: unknown[]; requestHeader: () => undefined }
  whenIdle: () => Promise<void>
  followup: ReturnType<typeof vi.fn>
  status: 'idle' | 'running'
}

function fakeContext() {
  const calls: string[] = []
  const registered: string[] = []
  const handlers = new Map<string, (invocation: { rawInput: string }) => unknown>()
  let agent: FakeAgent | undefined
  const llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }],
    listConfigurableProviders: () => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }],
    resolveCallConfig: async (c: { provider: string; model: string }) => ({ provider: c.provider, model: c.model }),
  }
  const ctx: any = {
    logger: { warn: () => {} },
    llm,
    get: (service: string) => {
      if (service === 'cmdlineArgs') return { get: () => [] as string[] }
      if (service === 'appExit') return () => { calls.push('exit') }
      if (service === 'loader') return { await: () => Promise.resolve() }
      if (service === 'credentials') return { set: vi.fn(async () => {}) }
      if (service === 'settings') return { update: vi.fn(async () => {}) }
      if (service === 'llm') return llm
      return undefined
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      saveSelection: vi.fn(async () => {}),
    },
    agents: {
      create: vi.fn(async () => {
        agent = {
          id: 'session-test',
          session: { events: [], requestHeader: () => undefined },
          whenIdle: async () => {},
          followup: vi.fn(),
          status: 'idle',
        }
        return { agent, dispose: vi.fn(async () => {}) }
      }),
      resume: vi.fn(async () => ({ agent: undefined, dispose: vi.fn(async () => {}) })),
    },
    sessions: {},
    sessionQuery: { listSessions: vi.fn(async () => []) },
    sessionProjections: { snapshot: () => ({ asOfSeq: 0, values: {} }) },
    userQuestions: { registerProvider: vi.fn(() => () => {}) },
    commands: {
      register: vi.fn((def: { name: string; handler: (invocation: { rawInput: string }) => unknown }) => {
        registered.push(def.name)
        handlers.set(def.name, def.handler)
      }),
      list: vi.fn(() => []),
      execute: vi.fn(async () => undefined),
    },
    tools: { get: () => undefined },
    on: vi.fn(() => () => {}),
    effect: vi.fn(() => () => {}),
  }
  return { ctx, calls, registered, handlers, getAgent: () => agent }
}

describe('host apply (full path)', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  })

  it('registers every TUI command and wires the seams', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    // The async boot runs startAgent; give the microtask queue a beat.
    await new Promise(resolve => setTimeout(resolve, 0))
    for (const command of ['help', 'quit', 'exit', 'new', 'clear', 'resume', 'sessions', 'model', 'providers', 'apikey', 'addprovider', 'rename', 'status', 'export']) {
      expect(registered).toContain(command)
    }
  })

  it('executes /providers and /model handlers without an inject error', async () => {
    const { ctx, handlers } = fakeContext()
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    // /providers reads ctx.llm via property access — the regression this guards.
    const providers = handlers.get('providers')
    expect(providers).toBeDefined()
    expect(providers!({ rawInput: '' })).toEqual({ kind: 'success' })
    // /model with an explicit provider/model switches in place.
    const modelHandler = handlers.get('model')
    expect(modelHandler).toBeDefined()
    expect(modelHandler!({ rawInput: 'deepseek-official/deepseek-v4-pro' })).toEqual({ kind: 'success' })
    // Give the async switch a beat to settle.
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('executes /status and /rename handlers', async () => {
    const { ctx, handlers } = fakeContext()
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    // /status reports the live session without throwing.
    const statusHandler = handlers.get('status')
    expect(statusHandler).toBeDefined()
    const status = statusHandler!({ rawInput: '' })
    expect(status).toMatchObject({ kind: 'success' })
    // /rename with no title is a validation error (no sessionTitle service here).
    const renameHandler = handlers.get('rename')
    expect(renameHandler).toBeDefined()
    expect(renameHandler!({ rawInput: '' })).toMatchObject({ kind: 'error' })
  })

  it('exports the plugin metadata', () => {
    expect(name).toBe('dsh-tui')
    for (const dep of ['agents', 'userQuestions', 'commands', 'tools', 'sessionProjections', 'llm']) {
      expect(inject).toContain(dep)
    }
  })
})
