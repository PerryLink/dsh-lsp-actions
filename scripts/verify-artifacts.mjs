// Verify the built artifacts after `pnpm run build`: syntax-check the host
// bundle, import it under plain Node, and assert the shipped files. Guards
// against TypeScript-only syntax leaking into shipped output and against a
// tarball missing the bundle patch.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertLegacySeam } from './seam-vintage-check.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const required = [
  'lib/index.js',
  'lib/index.d.ts',
  'cordis.patch.yml',
]
for (const rel of required) {
  if (!existsSync(path.join(root, rel))) throw new Error(`missing artifact: ${rel}`)
}

// 1. Syntax-check the host bundle (plain Node parse; no execution).
execFileSync(process.execPath, ['--check', path.join(root, 'lib/index.js')], { stdio: 'inherit' })

// 2. The ESM host face must import under plain Node (no tsx, no checkout paths).
const index = await import(pathToFileURL(path.join(root, 'lib/index.js')).href)
if (typeof index.apply !== 'function' || index.name !== 'lsp-actions') {
  throw new Error('lib/index.js exports an unexpected plugin face')
}

// 3. The self-built client exists only because the published seam carries FOUR operations and no
//    action vocabulary (see src/seam.ts: a code-less rejection is the `legacy` vintage). The moment
//    upstream lands the action face, this plugin's own client becomes a duplicate LSP stack and must
//    be dismantled — so fail the gate loudly instead of shipping it silently.
const seamTypes = path.join(root, 'node_modules/@deepseek-ai/dsh-lsp/lib/types/types.d.ts')
if (existsSync(seamTypes)) {
  assertLegacySeam(await readFile(seamTypes, 'utf8'))
}

console.log('artifacts OK: syntax + ESM import + bundle patch present + seam vintage still legacy')
