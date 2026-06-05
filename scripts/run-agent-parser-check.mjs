import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outfile = resolve('node_modules/.cache/agent-tool-parser-check.mjs')

await build({
  entryPoints: ['scripts/agent-tool-parser-check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: 'inline',
  define: {
    'import.meta.env': '{}',
  },
  outfile,
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
