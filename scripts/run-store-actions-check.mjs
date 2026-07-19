import { Buffer } from 'node:buffer'
import { build } from 'esbuild'

const result = await build({
  entryPoints: ['scripts/store-actions-check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  alias: { '@': `${process.cwd()}/src` },
  banner: {
    js: `globalThis.window = globalThis; globalThis.window.addEventListener = () => {}; globalThis.window.removeEventListener = () => {}; globalThis.document = { addEventListener: () => {}, visibilityState: 'visible' }; globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };`,
  },
})

const code = result.outputFiles[0].text
const encoded = Buffer.from(code, 'utf8').toString('base64')
try {
  await import(`data:text/javascript;base64,${encoded}`)
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
}
