/**
 * The seam-vintage gate: the plugin ships its own LSP client only while the published `ctx.lsp`
 * seam carries the four legacy operations. These cases pin both directions — the installed
 * published line passes, and a patched host (the upstream action face) fails loudly so the
 * self-built client gets dismantled instead of silently duplicating the LSP stack.
 * @module dsh-lsp-actions/test/seam-vintage
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertLegacySeam } from '../scripts/seam-vintage-check.mjs'

/** The installed published seam types (devDependencies pin the published line). */
const PUBLISHED = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-lsp/lib/types/types.d.ts', import.meta.url))

/** A minimal legacy-shaped source: the four-operation union plus the documented promise. */
const LEGACY_SOURCE = [
  '/** The seam exposes exactly the four operations and no JSON-RPC escape hatch. */',
  "export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover';",
].join('\n')

describe('assertLegacySeam', () => {
  it('accepts the installed published seam types', async () => {
    // Proof for the card's "the current line is legacy" assertion: the published union holds only
    // the four operations, so the plugin still needs its own client.
    const source = await readFile(PUBLISHED, 'utf8')
    expect(() => assertLegacySeam(source)).not.toThrow()
    const union = /export type LspOperation = ([^\n]+)/.exec(source)?.[1] ?? ''
    expect(union).toContain('goToDefinition')
    expect(union).not.toMatch(/documentSymbol|codeAction|completion|rename|inlayHint|signatureHelp|formatDocument/)
  })

  it('accepts a legacy-shaped source', () => {
    expect(() => assertLegacySeam(LEGACY_SOURCE)).not.toThrow()
  })

  it('fails when the union gains an action operation (the patched host)', () => {
    const patched = LEGACY_SOURCE.replace(
      "'hover';",
      "'hover' | 'documentSymbol' | 'codeAction';",
    )
    expect(() => assertLegacySeam(patched)).toThrow(/action vocabulary \(documentSymbol, codeAction\)/)
    expect(() => assertLegacySeam(patched)).toThrow(/remove this plugin's own LSP client/)
  })

  it('fails when the seam doc stops promising exactly four operations', () => {
    const reworded = LEGACY_SOURCE.replace('exactly the four operations and no JSON-RPC escape hatch', 'the semantic operations')
    expect(() => assertLegacySeam(reworded)).toThrow(/no longer promises/)
  })

  it('fails when the operation union disappears', () => {
    expect(() => assertLegacySeam('/** no union here */\nexport const LspOperation = 1\n')).toThrow(/declares no LspOperation union/)
  })
})
