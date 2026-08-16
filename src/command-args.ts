/**
 * Pure slash-command argument parsing for dsh-tui's own commands.
 *
 * No Cordis context: these functions turn raw command input into structured
 * arguments (or a validation error), so they are unit-testable without a live
 * harness. The host applies the parsed result to the real seams.
 */

/** Parsed `/apikey <ENV_VAR> <key>`. */
export type ApiKeyArgs =
  | { ok: true; ref: string; value: string }
  | { ok: false; error: string }

/** Parse the `/apikey` command's raw input. */
export function parseApiKey(rawInput: string): ApiKeyArgs {
  const parts = rawInput.trim().split(/\s+/)
  const ref = parts[0]
  const value = parts.slice(1).join(' ')
  if (ref === undefined || ref === '' || value === '') {
    return { ok: false, error: '/apikey needs <ENV_VAR> <key>, e.g. /apikey OPENAI_API_KEY sk-...' }
  }
  return { ok: true, ref, value }
}

/** Parsed `/addprovider <route> <baseURL> <ENV_VAR> <model,model,...>`. */
export type AddProviderArgs =
  | { ok: true; route: string; baseURL: string; apiKeyEnv: string; models: string[] }
  | { ok: false; error: string }

/** Parse the `/addprovider` command's raw input. */
export function parseAddProvider(rawInput: string): AddProviderArgs {
  const parts = rawInput.trim().split(/\s+/)
  const route = parts[0]
  const baseURL = parts[1]
  const apiKeyEnv = parts[2]
  const modelList = parts.slice(3).join(' ')
  if (route === undefined || route === '' || baseURL === undefined || baseURL === ''
    || apiKeyEnv === undefined || apiKeyEnv === '' || modelList === '') {
    return {
      ok: false,
      error: '/addprovider needs <route> <baseURL> <ENV_VAR> <model,model,...>\n'
        + '  e.g. /addprovider acme https://acme.example/v1 ACME_API_KEY acme-large,acme-think',
    }
  }
  const models = modelList.split(',').map(id => id.trim()).filter(id => id !== '')
  if (models.length === 0) {
    return { ok: false, error: '/addprovider: no models given' }
  }
  return { ok: true, route, baseURL, apiKeyEnv, models }
}

/** Split a `/model` argument into provider + model, falling back to the current provider. */
export function splitModelArg(rawInput: string, currentProvider: string): { provider: string; model: string } {
  const target = rawInput.trim()
  const slash = target.indexOf('/')
  if (slash >= 0) {
    return { provider: target.slice(0, slash), model: target.slice(slash + 1) }
  }
  return { provider: currentProvider, model: target }
}
