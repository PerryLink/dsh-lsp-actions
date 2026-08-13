# feat(lsp): add diagnostics/formatDocument/completion to the ctx.lsp seam

## Summary

Extends the `ctx.lsp` capability seam from four navigation operations to seven by adding `diagnostics`, `formatDocument`, and `completion`. The seam vocabulary (`LspOperation`, `LspQueryRequest`, `LspQueryResult`) becomes richer without changing the model-facing `lsp` tool, which still exposes only the four navigation operations and the same `locations`/`hover` output schema.

## Design decisions

- **Actions join the closed union.** `LspOperation` grows to seven members so every new operation is a compile-enforced change across the Service Definition, providers, and consumers — no JSON-RPC escape hatch.
- **The request becomes a discriminated union.** Three exact shapes — `LspPositionRequest`, `LspDiagnosticsRequest`, `LspFormatRequest` — replace the single flat request, so `operation` narrows to exactly the fields each operation carries (no hidden defaulting).
- **The result union grows to five kinds.** `locations`, `hover`, `diagnostics`, `edits`, and `completion`; `diagnostics`/`edits` carry the canonical `resolvedWorkspaceUri`.
- **Diagnostics has a push fallback.** A server with `diagnosticProvider` is pulled; a push-only server is served through the transient-open path with a bounded `diagnosticsSettleMs` window for `publishDiagnostics`.
- **Formatting returns edits the host never applies.** The stdio host stays read-only; a consumer applies the returned `LspTextEdit[]` through `ctx.fs` write-intent.
- **No keyless snapshot.** No in-repo model-visible behavior changes: `tool-lsp` keeps its four operations and output schema; the seam/provider additions surface only through the external consumer plugin.

## Files changed

- `packages/lsp/lsp/src/{types.ts,index.ts}` — seven-operation union, request/result vocabulary, re-exports.
- `packages/lsp/lsp-stdio/src/{protocol.ts,translate.ts,connection.ts,instance.ts,index.ts}` — wire types and capabilities, request-aware method/capability mapping, new normalizers, `onNotification`, push-diagnostics collection, config/schema/validation.
- `packages/lsp/lsp-stdio/tests/{translate.spec.ts,fixture-server.ts,instance.spec.ts,provider.spec.ts}` — new-operation coverage.
- `packages/lsp/tool-lsp/src/index.ts` — `execute` switch arms for the three new result kinds (throwing; the tool never requests them).
- Docs: `docs/subsystems/lsp.{md,zh.md}`, `docs/subsystems/README.md`, `docs/capability-seams.md`, `scripts/gen-doc-graphs.ts`, `scripts/type-equiv.manifest.json`, and the three package README pairs.
- `.agents/notes/implemented/architecture/2026-08-14-lsp-action-operations.md` — Agent Note.

## Testing performed

- `pnpm run typecheck`, `pnpm run lint`
- `pnpm --filter @deepseek-ai/dsh-lsp test`, `pnpm --filter @deepseek-ai/dsh-lsp-stdio test`, `pnpm --filter @deepseek-ai/dsh-tool-lsp test`
- `pnpm --filter @deepseek-ai/dsh-lsp --filter @deepseek-ai/dsh-lsp-stdio --filter @deepseek-ai/dsh-tool-lsp test:coverage`
- `pnpm run verify-type-equiv`, `pnpm run gen-cordis-catalog` + `pnpm run verify-cordis-catalog`
- `pnpm run verify-export-jsdoc`, `pnpm run verify-agent-note-format`, `pnpm run verify-cordis-api`

## Consumer

A consumer plugin (`dsh-lsp-actions`) implements `lsp_diagnostics`, `lsp_format`, and `lsp_completion` over this seam, each owning its own model-facing schema and applying formatting edits through `ctx.fs` write-intent.
