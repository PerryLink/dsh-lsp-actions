// The seam-vintage gate: the plugin ships its own LSP client only while the published `ctx.lsp`
// seam carries the four legacy operations and no action vocabulary (see src/seam.ts). The moment
// upstream lands the action face, the self-built client becomes a duplicate LSP stack and must be
// dismantled — this check fails loudly instead of shipping it silently.

/** The four operations the published seam exposes. */
const LEGACY_OPERATIONS = new Set(['goToDefinition', 'findReferences', 'goToImplementation', 'hover'])

/**
 * Assert one `@deepseek-ai/dsh-lsp` type source still describes the legacy four-operation seam.
 * @param source - the package's `lib/types/types.d.ts` contents.
 * @throws when the operation union gained an action operation, or the seam doc no longer promises
 *   exactly four operations.
 */
export function assertLegacySeam(source) {
  const union = /export type LspOperation = ([^\n]+)/.exec(source)?.[1] ?? ''
  const published = [...union.matchAll(/'([^']+)'/g)].map(match => match[1])
  const actionVocabulary = published.filter(operation => !LEGACY_OPERATIONS.has(operation))
  if (actionVocabulary.length > 0) {
    throw new Error(
      `the published ctx.lsp seam now carries the action vocabulary (${actionVocabulary.join(', ')}) — `
      + 'remove this plugin\'s own LSP client and route the eight tools through the seam instead',
    )
  }
  if (published.length === 0) {
    throw new Error('the published ctx.lsp seam declares no LspOperation union — re-read the upstream seam contract')
  }
  if (!/exactly the four operations/.test(source)) {
    throw new Error(
      'the published ctx.lsp seam doc no longer promises "exactly the four operations" — '
      + 're-read the upstream seam contract before shipping the self-built client',
    )
  }
}
