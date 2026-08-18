/**
 * Pure formatting for the status bar's stats line: turn/step counts, LLM/tool
 * wall time, first-token latency, decode throughput, cache hit rate, billed
 * tokens, and context occupancy. Mirrors @tomowang/dsh-tui's `statsFormat`
 * (itself mirroring the web portal's `StatsLine`) field-for-field so the
 * different dsh-tui surfaces read the same figures the same way; duplicated
 * rather than imported since this package carries no dependency on either.
 * @module dsh-tui/statsFormat
 */

export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export interface TokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ContextPressure {
  projectedTokens?: number
  pressureTokens?: number
  contextWindow?: number
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits). */
export function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Compact throughput: one decimal under 10 tok/s, whole above. */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** Sum the three disjoint prompt-side billing buckets. */
export function billedInputTokens(usage: TokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Cache-hit share of prompt-side input over the whole durable log. */
export function cacheHitPercent(usage: TokenUsage): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round((usage.cacheReadTokens / denominator) * 100)
}

/**
 * Build the pipe-separated stats line for the status bar, e.g.
 * `1 turns · 1 steps| LLM 4.3s| TTFT avg 1.1s · 131 tok/s| Cache hit 80%| Input 9.1K tok · Output 412 tok`.
 * A group with no data drops out whole; an empty return means nothing to show yet.
 */
export function buildStatsLine(stats: SessionStats | undefined, usage: TokenUsage | undefined): string {
  const groups: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    groups.push(`${stats.turns} turns · ${stats.steps} steps`)
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`)
    if (stats.toolMs > 0) durations.push(`Tool call ${formatDuration(stats.toolMs)}`)
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(`TTFT avg ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
    if (stats.decodeMs > 0) speeds.push(`${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`)
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(`Cache hit ${cacheHit}%`)
    groups.push(`Input ${formatTokens(billedInputTokens(usage))} tok · Output ${formatTokens(usage.outputTokens)} tok`)
  }
  return groups.join('| ')
}

/** Derive occupancy from the newest pressure sample, or `null` while either side hasn't arrived yet. */
export function contextOccupancy(pressure: ContextPressure | undefined): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Build the always-on compact context-usage line, e.g. `Context 1% · ~8.1K / 1M tok`. */
export function buildContextLine(pressure: ContextPressure | undefined): string {
  const occupancy = contextOccupancy(pressure)
  if (occupancy === null) return ''
  return `Context ${occupancy.percent}% · ~${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)} tok`
}
