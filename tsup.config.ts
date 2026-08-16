import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'node22',
  // The host seams are provided by the dsh installation at runtime; never
  // bundle them (single Cordis/Session instance across the whole tree).
  external: [/^@deepseek-ai\//],
})
