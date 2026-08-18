/**
 * Lifecycle and export-contract suite: the HMR-safety test (dispose the
 * contributing fiber, re-query the authoritative tool registry) and the
 * default-export guard (module namespace + Loader unwrap round-trip). The
 * plugin injects `tools`/`fs`/`subprocess`; `tools` is the real ToolRuntime,
 * while `fs`/`subprocess` are minimal stubs (with empty servers the plugin
 * never calls them at apply time) and `systemPrompt` is the ToolRuntime peer.
 * @module dsh-lsp-actions/test/lifecycle.spec
 */

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

const ALL_TOOLS = ['lsp_code_action', 'lsp_completion', 'lsp_diagnostics', 'lsp_format', 'lsp_inlay_hints', 'lsp_rename', 'lsp_signature', 'lsp_symbols']

async function mountHarness(): Promise<Context> {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  ctx.provide('fs', { sandboxMode: undefined })
  ctx.provide('subprocess', {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function loadPlugin(): Promise<typeof import('../src/index.ts')> {
  return await import('../src/index.ts')
}

// ---------------------------------------------------------------------------
// C2: the namespace plugin must survive Loader unwrapping
// ---------------------------------------------------------------------------

describe('export contract', () => {
  it('carries no default export and Loader unwrap round-trips the namespace', async () => {
    const plugin = await loadPlugin()
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as { unwrapExports: (mod: unknown) => unknown }
    const unwrapped = loader.unwrapExports(plugin)
    expect(unwrapped).toBe(plugin)
    expect((unwrapped as { name: string }).name).toBe('lsp-actions')
    expect((unwrapped as { inject: string[] }).inject).toEqual(['tools', 'fs', 'subprocess'])
    expect(typeof (unwrapped as { apply: unknown }).apply).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// C1: disposing the contributing fiber removes every registry contribution
// ---------------------------------------------------------------------------

describe('fiber disposal', () => {
  it('removes all eight tools from the registry when the plugin fiber is disposed', async () => {
    const ctx = await mountHarness()
    const plugin = await loadPlugin()
    const config = plugin.Config({})
    const fiber = await ctx.plugin(plugin as never, config as never)
    try {
      for (const name of ALL_TOOLS) {
        expect(ctx.tools.get(name), `${name} should be registered`).toBeDefined()
      }

      await fiber.dispose()

      for (const name of ALL_TOOLS) {
        expect(ctx.tools.get(name), `${name} should be removed on dispose`).toBeUndefined()
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
