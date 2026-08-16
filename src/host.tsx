/**
 * dsh-tui host plugin: the terminal UI front door.
 *
 * Consumes the host seams dsh-base provides — `agents`, `sessions`,
 * `sessionQuery`, `userQuestions`, `approval`, `commands`, `tools`,
 * `agentDefaultModel`, plus the launcher facts `cmdlineArgs`/`appExit` — and
 * owns the terminal, the ink render tree, and the interactive agent loop.
 *
 * @module dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { render } from 'ink'
import { App } from './render/app.tsx'
import { TuiStore } from './store.ts'
import type { SelectOption } from './store.ts'
import type { ToolPresenter } from './transcript.ts'
import type { TuiController } from './controller.ts'
import { parseTuiArgs, TUI_HELP } from './cmdline.ts'
import { parseApiKey, parseAddProvider, splitModelArg } from './command-args.ts'
import type { MarkdownTheme } from './markdown.tsx'

/** The plugin's stable Cordis name. */
export const name = 'dsh-tui'

/** Host services required before the TUI can mount. */
export const inject = ['agents', 'sessions', 'agentDefaultModel', 'sessionQuery', 'userQuestions', 'commands', 'tools', 'sessionProjections', 'llm']

/** The light/dark markdown themes for the render tree. */
const THEMES: Record<'dark' | 'light', MarkdownTheme> = {
  dark: { text: {}, muted: { dim: true }, accent: { color: 'cyan' }, code: { color: 'yellow' } },
  light: { text: { color: 'black' }, muted: { dim: true }, accent: { color: 'cyan' }, code: { color: 'yellow' } },
}

/**
 * A presenter backed by `ctx.tools`: resolves each tool's declared render
 * intent, soft-falling to undefined on a missing definition or a throwing
 * presenter (the generic card covers it). The scope is the live agent so
 * preset-scoped tools resolve too.
 */
function makePresenter(ctx: Context, scope: Agent | undefined): ToolPresenter {
  return {
    presentCall(toolName: string, argsJson: string): ToolCallView | undefined {
      try {
        return ctx.tools.get(toolName, scope)?.presentCall?.(JSON.parse(argsJson))
      } catch {
        return undefined
      }
    },
    presentResult(toolName: string, argsJson: string, content, isError, meta): ToolResultView | undefined {
      try {
        return ctx.tools.get(toolName, scope)?.presentResult?.(JSON.parse(argsJson), { content, isError, meta })
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Apply the terminal UI plugin.
 * @param ctx - the host context carrying the core services and launcher facts.
 */
export function apply(ctx: Context): void {
  const cmdline = ctx.get('cmdlineArgs')
  const appExit = ctx.get('appExit')
  const args = parseTuiArgs(cmdline?.get() ?? [])

  if (args.help) {
    process.stdout.write(TUI_HELP)
    appExit?.(0)
    return
  }
  if (appExit === undefined) {
    throw new Error('dsh-tui: the launcher must provide ctx.appExit before the tree mounts')
  }

  const store = new TuiStore()
  let agentHandle: AgentHandle | undefined
  let agent: Agent | undefined
  let quitRequested = false
  let tornDown = false

  let model: ModelSelection = args.model !== undefined
    ? { provider: ctx.agentDefaultModel.currentSelection().provider, model: args.model }
    : ctx.agentDefaultModel.currentSelection()

  store.setModel(model)
  store.setStatus('booting')

  // --- Presenter: re-resolves the live agent as the tool scope. ------------
  const presenter: ToolPresenter = {
    presentCall: (n, a) => makePresenter(ctx, agent).presentCall(n, a),
    presentResult: (n, a, c, e, m) => makePresenter(ctx, agent).presentResult(n, a, c, e, m),
  }
  store.setPresenter(presenter)

  // --- Per-agent model selection -------------------------------------------
  // Mirrors api-proxy's selectionFor: one mutable ref per agent, installed at
  // setup, whose `current` reads "picked this process → logged request header
  // → live default". Switches mutate the ref, so the running agent changes
  // model without a session rebuild.
  interface TuiSelectionRef extends ModelSelectionRef { current: ModelSelection }
  const selections = new WeakMap<Agent, TuiSelectionRef>()

  function selectionFor(target: Agent): TuiSelectionRef {
    const installed = selections.get(target)
    if (installed !== undefined) return installed
    let picked: ModelSelection | undefined
    const ref: TuiSelectionRef = {
      get current(): ModelSelection {
        if (picked !== undefined) return picked
        const logged = target.session.requestHeader()?.config
        if (logged === undefined) return model
        return {
          provider: logged.provider,
          model: logged.model,
          ...(logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort }),
        }
      },
      set current(next: ModelSelection) {
        picked = next
      },
      assembled: undefined,
    }
    selections.set(target, ref)
    return ref
  }

  /** Compose an agent scope with the per-agent model selection. */
  const setup = (agentCtx: Context): void => {
    const scoped = agentCtx.agent
    if (scoped === undefined) throw new Error('dsh-tui: agent setup has no scoped agent')
    installModelSelection(agentCtx, selectionFor(scoped))
  }

  /** Create or resume one agent and feed its log into the store. */
  async function startAgent(resumeId: string | undefined): Promise<void> {
    store.setStatus('booting')
    if (resumeId !== undefined) {
      agentHandle = await ctx.agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions: { provider: model.provider, model: model.model },
        setup,
      })
    } else {
      agentHandle = await ctx.agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: model.provider, model: model.model },
        setup,
      })
    }
    agent = agentHandle.agent
    store.setSessionId(agent.id)
    // Replay the durable log (a resume's seed is not re-published).
    store.replay(agent.session.events)
    await agent.whenIdle()
    store.setStatus('idle')
  }

  /** Swap onto another session in-process: dispose, then resume/create. */
  async function switchSession(id: string | undefined): Promise<void> {
    const old = agentHandle
    agentHandle = undefined
    agent = undefined
    if (old !== undefined) await old.dispose()
    await startAgent(id)
  }

  /** Dispose the agent and unmount ink once; shared by both exit paths. */
  async function disposeAll(): Promise<void> {
    if (tornDown) return
    tornDown = true
    quitRequested = true
    try {
      await agentHandle?.dispose()
    } finally {
      disposeQuestions()
      inkInstance.unmount()
    }
  }

  async function teardown(): Promise<void> {
    await disposeAll()
    appExit?.(0)
  }

  function quit(): void {
    if (quitRequested) return
    void teardown()
  }

  // --- Session event feed --------------------------------------------------
  ctx.on('session/event', (session: { id: string }, event: SessionEvent) => {
    if (agent === undefined || session.id !== agent.id) return
    store.pushEvent(event)
    if (event.type === 'turn/start') store.setStatus('running')
    if (event.type === 'turn/end') void agent?.whenIdle().then(() => { store.setStatus('idle') })
  })

  // --- User-questions provider ---------------------------------------------
  const disposeQuestions = ctx.userQuestions.registerProvider({
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      if (request.signal?.aborted === true) {
        return Promise.reject(new Error('ask aborted'))
      }
      const pending = store.ask(request)
      const onAbort = (): void => { store.rejectQuestion(new Error('ask aborted')) }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      return pending.finally(() => { request.signal?.removeEventListener('abort', onAbort) })
    },
  })

  // --- Approval answerer (waterfall) ---------------------------------------
  ctx.on('approval/request', (req, next) => {
    if (agent === undefined || req.agent.id !== agent.id) return next()
    if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
    const pending = store.approve(req.toolName, req.reason)
    const onAbort = (): void => { store.answerApproval('cancelled') }
    req.signal?.addEventListener('abort', onAbort, { once: true })
    return pending.finally(() => { req.signal?.removeEventListener('abort', onAbort) })
  })

  // --- Command option providers --------------------------------------------
  // A command whose bare invocation should offer a picker maps to a provider
  // that yields a SelectOption list (sync from projections, or async from the
  // llm catalog) and an optional onSelect. Default onSelect dispatches
  // `/<name> <value>` through the ordinary registry; a command with a richer
  // handler overrides it.
  interface CommandOptionProvider {
    title: string
    options(): readonly SelectOption[] | Promise<readonly SelectOption[]>
    currentValue?(): string | undefined
    onSelect?(value: string): Promise<void>
  }

  /** Resolve the option providers available for the live agent. */
  function optionProviders(): Map<string, CommandOptionProvider> {
    const providers = new Map<string, CommandOptionProvider>()
    if (agent === undefined) return providers
    const values = ctx.sessionProjections.snapshot(agent.session).values as Record<string, unknown>
    // The `permissions` projection (registered by dsh-permission-presets) is
    // read structurally: its key is declaration-merged by that package, which
    // this out-of-tree bundle does not import, so the value is a plain record
    // with `options` + `currentValue` at runtime.
    const permissions = values.permissions as
      | { options?: Array<{ value: string; name: string; description?: string }>; currentValue?: string }
      | undefined
    if (permissions !== undefined && Array.isArray(permissions.options) && permissions.options.length > 0) {
      providers.set('permission', {
        title: 'permission preset',
        options: () => permissions.options!.map(o => ({ value: o.value, label: o.name, description: o.description })),
        currentValue: () => permissions.currentValue,
      })
    }
    // The model picker: every registered provider's advertised models, flattened
    // to `provider/model` rows with the current route marked.
    providers.set('model', {
      title: 'model',
      options: async () => {
        const rows: SelectOption[] = []
        for (const provider of ctx.llm.listProviders()) {
          try {
            const models = await ctx.llm.listModels(provider.id)
            for (const m of models) {
              rows.push({ value: `${provider.id}/${m.id}`, label: `${provider.name}: ${m.name}`, description: m.description })
            }
          } catch {
            // A provider whose catalog fails still lists its peers.
          }
        }
        return rows
      },
      currentValue: () => `${model.provider}/${model.model}`,
      onSelect: (value) => switchModel(value),
    })
    return providers
  }

  /** Switch the live agent's model in place (no session rebuild). */
  async function switchModel(value: string): Promise<void> {
    if (agent === undefined) return
    const slash = value.indexOf('/')
    if (slash < 0) return
    const provider = value.slice(0, slash)
    const modelId = value.slice(slash + 1)
    try {
      const resolved = await ctx.llm.resolveCallConfig({ provider, model: modelId })
      const next: ModelSelection = {
        provider: resolved.provider,
        model: resolved.model,
        ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
      }
      selectionFor(agent).current = next
      model = next
      store.setModel(next)
      try {
        await ctx.agentDefaultModel.saveSelection(next)
      } catch (error) {
        ctx.logger.warn(`dsh-tui: model switched but not saved as default: ${String(error)}`)
      }
    } catch (error) {
      store.setNotice(`/model failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      setTimeout(() => { store.setNotice(undefined) }, 6000)
    }
  }

  /** Export the current session log to a JSON file, and surface the path. */
  async function exportSession(sessionId: string, file: string | undefined): Promise<void> {
    try {
      const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId))
      const dir = join(homedir(), '.dsh', 'exports')
      mkdirSync(dir, { recursive: true })
      const target = file !== undefined
        ? (resolve(file))
        : join(dir, `${sessionId}.json`)
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, JSON.stringify({ session: snapshot.session, events: snapshot.events }, null, 2))
      store.setNotice(`exported to ${target}`)
      setTimeout(() => { store.setNotice(undefined) }, 8000)
    } catch (error) {
      store.setNotice(`/export failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      setTimeout(() => { store.setNotice(undefined) }, 8000)
    }
  }

  /** Execute one slash-command line against the live agent. */
  async function executeCommand(line: string): Promise<void> {
    if (agent === undefined) return
    const outcome = await ctx.commands.execute(agent, line, new AbortController().signal)
    if (outcome === undefined) {
      store.setNotice(`unknown command: ${line}`, 'error')
    } else if (outcome.result.kind === 'error') {
      store.setNotice(outcome.result.text, 'error')
    } else if (outcome.result.text !== undefined && outcome.result.text !== '') {
      // Success text (command output) is surfaced as a multi-line notice so
      // /status, /rename, /providers, … have visible feedback.
      store.setNotice(outcome.result.text)
    }
    setTimeout(() => { store.setNotice(undefined) }, 8000)
  }

  /** Dispatch a slash line; a bare command with a picker opens the menu first. */
  async function dispatchCommand(line: string): Promise<void> {
    if (agent === undefined) return
    const trimmed = line.trim()
    const name = trimmed.replace(/^\//, '').split(/\s+/)[0] ?? ''
    const hasArg = trimmed !== name && trimmed !== `/${name}`
    const provider = optionProviders().get(name)
    if (!hasArg && provider !== undefined) {
      const chosen = await store.select(provider.title, await provider.options(), provider.currentValue?.())
      if (chosen === undefined) return // cancelled
      if (provider.onSelect !== undefined) {
        await provider.onSelect(chosen)
      } else {
        await executeCommand(`/${name} ${chosen}`)
      }
      return
    }
    await executeCommand(line)
  }

  // --- The ink App controller ----------------------------------------------
  const controller: TuiController = {
    submit(line: string): void {
      if (agent === undefined) return
      if (line.startsWith('/')) {
        void dispatchCommand(line)
        return
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line }],
        source: { kind: 'user' },
      }))
    },
    answerQuestion(answer: AskUserQuestionAnswer): void {
      store.answerQuestion(answer)
    },
    rejectQuestion(error: unknown): void {
      store.rejectQuestion(error)
    },
    answerApproval(outcome: ApprovalOutcome): void {
      store.answerApproval(outcome)
    },
    quit(): void {
      quit()
    },
    refreshSessions(): void {
      void (async () => {
        const sessions = await ctx.sessionQuery.listSessions()
        store.setSessions(sessions)
      })()
    },
    switchSession(id: string): void {
      void switchSession(id === '' ? undefined : id)
    },
    listCommands() {
      return agent === undefined ? [] : ctx.commands.list(agent).map(c => ({
        name: c.name, description: c.description, ...(c.input === undefined ? {} : { input: c.input }),
      }))
    },
  }

  // --- Render + teardown ---------------------------------------------------
  // ink needs a real TTY on stdin for raw mode. Without one, degrade to a
  // one-shot message instead of a fatal load failure (mirrors headless' stderr
  // discipline for non-interactive invocations).
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('dsh-tui: requires an interactive terminal (stdin/stdout must be a TTY)\n')
    appExit(1)
    return
  }
  const inkInstance = render(
    <App store={store} controller={controller} theme={THEMES.dark} banner={!args.noBanner} />,
  )

  ctx.effect(() => () => {
    void disposeAll()
  }, 'dsh-tui: teardown')

  // Ctrl+C in ink closes the instance; then request exit.
  void inkInstance.waitUntilExit().then(() => {
    if (!quitRequested) quit()
  })

  void startAgent(args.resumeId).catch((error: unknown) => {
    store.setStatus('idle')
    store.setNotice(`boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
  })

  // Register the TUI's own slash commands (help/quit) so they dispatch through
  // the same registry and appear in /help.
  ctx.commands.register({
    name: 'help',
    description: 'list slash commands',
    handler: () => ({ kind: 'success', text: 'commands: ' + controller.listCommands().map(c => `/${c.name}`).join(', ') }),
  })
  ctx.commands.register({
    name: 'quit',
    description: 'exit the terminal UI',
    handler: () => { quit(); return { kind: 'success' } },
  })
  ctx.commands.register({
    name: 'new',
    description: 'start a new session',
    handler: () => { void switchSession(undefined); return { kind: 'success' } },
  })
  ctx.commands.register({
    name: 'resume',
    description: 'resume a session by id',
    input: { hint: 'session id' },
    handler: ({ rawInput }) => {
      const id = rawInput.trim()
      if (id === '') return { kind: 'error', text: '/resume needs a session id' }
      void switchSession(id)
      return { kind: 'success' }
    },
  })
  ctx.commands.register({
    name: 'sessions',
    description: 'list recent sessions',
    handler: () => {
      void (async () => {
        const sessions = await ctx.sessionQuery.listSessions()
        const text = sessions.length === 0
          ? 'no sessions'
          : sessions.map(s => `${s.header.id}${s.live ? ' (live)' : ''}`).join('\n')
        store.setNotice(text)
        setTimeout(() => { store.setNotice(undefined) }, 8000)
      })()
      return { kind: 'success' }
    },
  })
  ctx.commands.register({
    name: 'clear',
    description: 'clear the current conversation (start a fresh session)',
    handler: () => { void switchSession(undefined); return { kind: 'success' } },
  })
  ctx.commands.register({
    name: 'rename',
    description: 'rename the current session',
    input: { hint: '<title>' },
    handler: ({ rawInput }) => {
      const title = rawInput.trim()
      if (title === '') return { kind: 'error', text: '/rename needs a title' }
      if (agent === undefined) return { kind: 'error', text: 'no active session' }
      const titles = ctx.get('sessionTitle')
      if (titles === undefined) return { kind: 'error', text: 'session-title service not composed' }
      try {
        titles.rename(agent.session, title)
        return { kind: 'success', text: `renamed to ${title}` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  ctx.commands.register({
    name: 'status',
    description: 'show current session status',
    handler: () => {
      if (agent === undefined) return { kind: 'error', text: 'no active session' }
      const last = agent.session.events.at(-1)
      const lastUsage = last !== undefined && last.type === 'assistant/message' ? last.data.usage : undefined
      const tokens = lastUsage !== undefined
        ? `${lastUsage.inputTokens + (lastUsage.cacheReadTokens ?? 0)} in / ${lastUsage.outputTokens} out`
        : '—'
      return {
        kind: 'success',
        text: [
          `session: ${agent.id}`,
          `model: ${model.provider}/${model.model}`,
          `tokens (last): ${tokens}`,
          `events: ${agent.session.events.length}`,
          `status: ${agent.status}`,
        ].join('\n'),
      }
    },
  })
  ctx.commands.register({
    name: 'exit',
    description: 'exit the terminal UI (alias of /quit)',
    handler: () => { quit(); return { kind: 'success' } },
  })
  ctx.commands.register({
    name: 'export',
    description: 'export the current session log to a JSON file',
    handler: ({ rawInput }) => {
      if (agent === undefined) return { kind: 'error', text: 'no active session' }
      const file = rawInput.trim() || undefined
      void exportSession(agent.id, file)
      return { kind: 'success' }
    },
  })
  // /model is declared as a bare picker (optionProviders above); an explicit
  // argument form still resolves here so `/model <provider>/<model>` works too.
  ctx.commands.register({
    name: 'model',
    description: 'list or switch models',
    input: { hint: '[provider/model]' },
    handler: ({ rawInput }) => {
      const target = rawInput.trim()
      if (target === '') return { kind: 'success', text: `current model: ${model.provider}/${model.model}` }
      const { provider, model: modelId } = splitModelArg(target, model.provider)
      void switchModel(`${provider}/${modelId}`)
      return { kind: 'success' }
    },
  })
  ctx.commands.register({
    name: 'providers',
    description: 'list configurable LLM providers',
    handler: () => {
      void (async () => {
        const live = new Set(ctx.llm.listProviders().map(p => p.id))
        const entries = ctx.llm.listConfigurableProviders()
        const text = entries.length === 0
          ? 'no configurable providers'
          : entries.map(e => `${live.has(e.provider) ? '●' : '○'} ${e.provider} — ${e.displayName}${e.declared === true ? ' (custom)' : ''}`).join('\n')
        store.setNotice(text)
        setTimeout(() => { store.setNotice(undefined) }, 12000)
      })()
      return { kind: 'success' }
    },
  })
  ctx.commands.register({
    name: 'apikey',
    description: 'store an API key credential (env var name + value)',
    input: { hint: '<ENV_VAR> <key>' },
    handler: ({ rawInput }) => {
      const parsed = parseApiKey(rawInput)
      if (!parsed.ok) return { kind: 'error', text: parsed.error }
      void (async () => {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) {
          store.setNotice('no credentials service composed')
          return
        }
        await credentials.set(credentialRef(parsed.ref), parsed.value)
        store.setNotice(`stored API key ${parsed.ref}`)
        setTimeout(() => { store.setNotice(undefined) }, 5000)
      })().catch((error: unknown) => {
        store.setNotice(`/apikey failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
        setTimeout(() => { store.setNotice(undefined) }, 6000)
      })
      return { kind: 'success' }
    },
  })
  ctx.commands.register({
    name: 'addprovider',
    description: 'add an OpenAI-compatible provider (name, baseURL, apiKeyEnv, model ids)',
    input: { hint: '<route> <baseURL> <ENV_VAR> <model,model,...>' },
    handler: ({ rawInput }) => {
      const parsed = parseAddProvider(rawInput)
      if (!parsed.ok) return { kind: 'error', text: parsed.error }
      void (async () => {
        const settings = ctx.get('settings')
        if (settings === undefined) {
          store.setNotice('no settings service composed')
          return
        }
        await settings.update(settingsNamespace('llm-pi-ai'), {
          providers: {
            [parsed.route]: {
              displayName: parsed.route,
              apiKeyEnv: parsed.apiKeyEnv,
              baseURL: parsed.baseURL,
              api: 'openai-completions',
              models: parsed.models.map(id => ({ id })),
            },
          },
        })
        store.setNotice(`added provider ${parsed.route}; set /apikey ${parsed.apiKeyEnv} <key>, then /model to pick it`)
        setTimeout(() => { store.setNotice(undefined) }, 10000)
      })().catch((error: unknown) => {
        store.setNotice(`/addprovider failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
        setTimeout(() => { store.setNotice(undefined) }, 8000)
      })
      return { kind: 'success' }
    },
  })
}
