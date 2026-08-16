/**
 * Terminal palette and styling tokens for dsh-tui.
 *
 * One inspectable table of roles → ANSI color pairs, kept light/dark aware so
 * the same component code reads well on both backgrounds. Components import
 * {@link palette} and compose styles; they never emit raw SGR sequences.
 */

/** One terminal color role: foreground + background as ANSI SGR color codes. */
export interface PaletteRole {
  /** Foreground color (e.g. `cyan`, `white`, or an ANSI 256 number). */
  fg: string
  /** Background color, or `undefined` for the terminal default. */
  bg?: string
  /** Extra attributes: bold, dim, italic, underline. */
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export type PaletteScheme = 'dark' | 'light'

/** The complete palette table, keyed by semantic role. */
export type Palette = Record<PaletteRoleName, PaletteRole>

/** Semantic roles components reference. */
export type PaletteRoleName =
  | 'text'
  | 'muted'
  | 'accent'
  | 'accentBright'
  | 'user'
  | 'assistant'
  | 'success'
  | 'error'
  | 'warning'
  | 'diffAdd'
  | 'diffRemove'
  | 'border'
  | 'codeBg'
  | 'codeText'
  | 'thinking'
  | 'spinner'
  | 'statusBar'
  | 'statusBarText'
  | 'input'
  | 'inputPlaceholder'
  | 'prompt'

/** Shared light-scheme roles (both schemes share the muted recessed tone). */
const LIGHT: Palette = {
  text: { fg: 'black' },
  muted: { fg: 'black', dim: true },
  accent: { fg: 'cyan' },
  accentBright: { fg: 'cyan', bold: true },
  user: { fg: 'black', bold: true },
  assistant: { fg: 'black' },
  success: { fg: 'green' },
  error: { fg: 'red', bold: true },
  warning: { fg: 'yellow' },
  diffAdd: { fg: 'green' },
  diffRemove: { fg: 'red' },
  border: { fg: 'black', dim: true },
  codeBg: { fg: 'black', bg: 'white', dim: true },
  codeText: { fg: 'black' },
  thinking: { fg: 'black', dim: true },
  spinner: { fg: 'cyan' },
  statusBar: { fg: 'black', bg: 'cyan' },
  statusBarText: { fg: 'black', bg: 'cyan', bold: true },
  input: { fg: 'black' },
  inputPlaceholder: { fg: 'black', dim: true },
  prompt: { fg: 'cyan', bold: true },
}

/** Dark scheme derives from the light table, swapping foregrounds to light tones. */
const DARK: Palette = {
  ...LIGHT,
  text: { fg: 'white' },
  muted: { fg: 'white', dim: true },
  user: { fg: 'white', bold: true },
  assistant: { fg: 'white' },
  border: { fg: 'white', dim: true },
  codeBg: { fg: 'white', bg: 'black', dim: true },
  codeText: { fg: 'white' },
  thinking: { fg: 'white', dim: true },
  input: { fg: 'white' },
  inputPlaceholder: { fg: 'white', dim: true },
}

/** Resolve the palette for a color scheme. */
export function palette(scheme: PaletteScheme): Palette {
  return scheme === 'dark' ? DARK : LIGHT
}

/** Detect a light terminal background from the COLORFGBG environment convention. */
export function detectScheme(): PaletteScheme {
  const colorfgbg = process.env.COLORFGBG ?? ''
  // COLORFGBG is usually `<fg>;<bg>` (e.g. `15;0`). A light background often
  // has a high background value (15 = white) on terminals that set it.
  const bg = colorfgbg.split(';').at(-1)
  return bg === '15' || bg === '7' ? 'light' : 'dark'
}
