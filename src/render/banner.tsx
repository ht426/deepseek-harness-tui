/**
 * Startup banner: a Claude Code-style welcome box — a rounded border around a
 * block-letter logo, the current model, and a compact hint block, sized to the
 * terminal width via `width="100%"`. Shown only over a fresh, empty session.
 */

import { Box, Text } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'

/** Block-letter "dsh" logo, one string per row. */
const LOGO: readonly string[] = [
  '██████╗  ███████╗ ██╗  ██╗',
  '██╔══██╗ ██╔════╝ ██║  ██║',
  '██║  ██║ ███████╗ ███████║',
  '██║  ██║ ╚════██║ ██╔══██║',
  '██████╔╝ ███████║ ██║  ██║',
  '╚═════╝  ╚══════╝ ╚═╝  ╚═╝',
]

/** Keybindings, rendered inline as `key desc`. */
const KEYS: readonly [string, string][] = [
  ['Enter', 'send'],
  ['Ctrl+C', 'quit'],
  ['Ctrl+O', 'detail'],
  ['Ctrl+T', 'trajectory'],
  ['Esc', 'cancel'],
]

/** Commands, rendered inline as `/name hint`. */
const COMMANDS: readonly [string, string][] = [
  ['/help', 'commands'],
  ['/model', 'pick model'],
  ['/resume <id>', 'continue'],
  ['/sessions', 'list'],
]

export function Banner({ model }: { model?: ModelSelection }): React.ReactNode {
  return (
    <Box width="100%" flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
      <Box
        width="100%"
        borderStyle="round"
        borderColor="cyan"
        paddingY={1}
        flexDirection="column"
        alignItems="center"
      >
        {LOGO.map((line, i) => (
          <Text key={i} color="cyan" bold>{line}</Text>
        ))}

        <Text color="gray" dimColor>DeepSeek Harness · terminal UI</Text>

        {model !== undefined
          ? (
              <Text>
                <Text color="cyan">model</Text>
                <Text color="gray"> · </Text>
                <Text>{model.provider}/{model.model}</Text>
              </Text>
            )
          : null}

        <Text color="gray">──────────────────────────────────</Text>

        <Text>
          {COMMANDS.map(([cmd, hint], i) => (
            <Text key={cmd}>
              {i > 0 ? <Text color="gray">  ·  </Text> : null}
              <Text color="cyan">{cmd}</Text>
              <Text color="gray"> {hint}</Text>
            </Text>
          ))}
        </Text>

        <Text color="gray">
          {KEYS.map(([key, desc], i) => (
            <Text key={key}>
              {i > 0 ? '  ·  ' : ''}
              <Text color="cyan">{key}</Text>
              {` ${desc}`}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  )
}
