/**
 * dsh-tui entry point: re-exports the host plugin for the Cordis Loader.
 *
 * @module dsh-tui
 */

export { name, inject, apply } from './host.tsx'
export { TuiStore } from './store.ts'
export type { TuiSnapshot, Modal } from './store.ts'
export { Transcript } from './transcript.ts'
export type { TranscriptNode, ToolPresenter, ToolFinish } from './transcript.ts'
export { parseTuiArgs, TUI_HELP } from './cmdline.ts'
export type { TuiArgs } from './cmdline.ts'
export type { TuiController, SessionChoice } from './controller.ts'
