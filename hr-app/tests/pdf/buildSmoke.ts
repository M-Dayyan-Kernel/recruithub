/**
 * Bundles tests/pdf/smokeEntry.tsx with esbuild so Node can run the react-pdf components.
 *
 * Node cannot import .tsx or `?url` assets, so the entry is bundled (react and react-pdf stay
 * external, so there is one copy of each) and the font imports are turned into file paths, which
 * react-pdf reads from disk. The output lives in node_modules/.cache, inside the project, so the
 * external packages resolve.
 */
import { build, type Plugin } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const fontUrls: Plugin = {
  name: 'font-urls',
  setup(b) {
    b.onResolve({ filter: /\.ttf\?url$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?url$/, '')),
      namespace: 'font-path',
    }))
    b.onLoad({ filter: /.*/, namespace: 'font-path' }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)}`,
      loader: 'js',
    }))
  },
}

export interface Smoke {
  renderAll: () => Promise<{ name: string; buffer: Buffer }[]>
  timeBundle: (count: number) => Promise<{ ms: number; bytes: number }>
}

export async function buildSmoke(): Promise<Smoke> {
  const outDir = resolve(root, 'node_modules/.cache/pdf-smoke')
  mkdirSync(outDir, { recursive: true })
  const outfile = resolve(outDir, `smoke-${process.pid}.mjs`)
  await build({
    entryPoints: [resolve(root, 'tests/pdf/smokeEntry.tsx')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    packages: 'external',
    outfile,
    plugins: [fontUrls],
    logLevel: 'silent',
  })
  return (await import(pathToFileURL(outfile).href)) as Smoke
}
