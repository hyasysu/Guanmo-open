import { Buffer } from 'node:buffer'
import { build } from 'esbuild'

const result = await build({
  entryPoints: ['scripts/runtime-schemas-check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  alias: { '@': `${process.cwd()}/src` },
  plugins: [{
    name: 'tauri-runtime-schema-mocks',
    setup(context) {
      context.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'tauri-core', namespace: 'runtime-mock' }))
      context.onLoad({ filter: /.*/, namespace: 'runtime-mock' }, () => ({
        contents: 'export const invoke = async () => {}; export class Channel {}',
        loader: 'js',
      }))
    },
  }],
})

const encoded = Buffer.from(result.outputFiles[0].text, 'utf8').toString('base64')
try {
  await import(`data:text/javascript;base64,${encoded}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
