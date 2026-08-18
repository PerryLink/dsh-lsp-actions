// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative tool registry and proves the
// `editor.enabled` default is off (the editor JSON-RPC transport would attach
// a stdin data listener only when enabled).
//
// Usage: node scripts/loader-runner.mjs <cordis.yml>
// Exit 0 prints DSH_LOADER_RESULT <json>; any assertion or load failure exits
// non-zero with the reason on stderr (used by the invalid-config and
// default-export regression cases).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
if (configArgument === undefined) {
  console.error('usage: loader-runner.mjs <cordis.yml>')
  process.exit(2)
}

const configPath = resolve(configArgument)
// Resolve bare package rows from this repository's dependency tree so the
// composition works with config files written anywhere (e.g. a temp dir).
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))

const ctx = new Context()
try {
  // The plugin injects tools/fs/subprocess. `tools` comes from the real
  // `dsh-tools` row; `fs`/`subprocess` are abstract capabilities the plugin
  // never calls at apply time with an empty servers table, so a minimal stub
  // satisfies the inject here (the same stub the unit harness uses). The
  // `systemPrompt` stub is ToolRuntime's own peer.
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  ctx.provide('fs', { sandboxMode: undefined })
  ctx.provide('subprocess', {})

  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  // Authoritative registry: the eight LSP action tools must all be present.
  const toolNames = ctx.tools.schemas().map(schema => schema.name)
  const expectedTools = ['lsp_code_action', 'lsp_completion', 'lsp_diagnostics', 'lsp_format', 'lsp_inlay_hints', 'lsp_rename', 'lsp_signature', 'lsp_symbols']
  for (const name of expectedTools) {
    if (!toolNames.includes(name)) {
      throw new Error(`Loader composition: ${name} tool is missing from the tools registry`)
    }
  }

  // `editor.enabled` defaults to false: the editor protocol would attach a
  // stdin data listener only when enabled, so a zero listener count proves the
  // default composition left the IDE backend off.
  if (process.stdin.listenerCount('data') !== 0) {
    throw new Error(`Loader composition: editor protocol started despite the default editor.enabled: false (stdin data listeners: ${process.stdin.listenerCount('data')})`)
  }

  process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify({ tools: toolNames.sort(), editorOffByDefault: true })}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
}
