// Bundles web/src/client.js (+ its wireweave/xterm deps) into a single
// web/bundle.js for GH Pages — a plain static file, no server-side step
// needed at request time.

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: [path.join(dir, 'src/client.js')],
  outfile: path.join(dir, 'bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info'
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('watching web/src for changes...')
} else {
  await esbuild.build(options)
}
