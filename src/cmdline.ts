/**
 * dsh-tui app command line.
 *
 * The launcher hands every argument after its own flags to the tree verbatim
 * through `ctx.cmdlineArgs`; this app owns its own flag family. Parsed manually
 * (no commander dependency): the surface is small and the flags are positional
 * plus `--resume` / `--model` / `--no-banner` / `-h`.
 */

/** Parsed app invocation. */
export interface TuiArgs {
  /** Session id to resume, when `--resume <id>` was supplied. */
  resumeId: string | undefined
  /** Model id to select, when `--model <model>` was supplied. */
  model: string | undefined
  /** Suppress the startup banner. */
  noBanner: boolean
  /** Print help and exit without booting. */
  help: boolean
}

/** The app's own help text, printed on `--help`. */
export const TUI_HELP = `dsh tui — interactive terminal UI

Usage:
  dsh --profile tui [flags]

Flags:
  --resume <id>      resume the persisted session <id>
  --model <model>    select a model id for this session
  --no-banner        suppress the startup banner
  -h, --help         print this help and exit

Within the UI:
  type a message and press Enter to send
  /name              run a slash command (/help lists them)
  Ctrl+C             quit
  Ctrl+O             cycle transcript detail (folded / expanded / hidden)
  Ctrl+T             toggle the trajectory ledger (event timeline view)

Press Enter to continue.
`

/**
 * Parse the app's own argument snapshot.
 * @param argv - the inner arguments handed to the tree verbatim.
 * @returns the resolved invocation, with `help` true when `-h`/`--help` is present.
 */
export function parseTuiArgs(argv: readonly string[]): TuiArgs {
  let resumeId: string | undefined
  let model: string | undefined
  let noBanner = false
  let help = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '--no-banner') {
      noBanner = true
    } else if (arg === '--resume') {
      resumeId = argv[i + 1]
      i += 1
    } else if (arg === '--model') {
      model = argv[i + 1]
      i += 1
    }
  }
  return { resumeId, model, noBanner, help }
}
