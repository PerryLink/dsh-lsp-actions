# Upstream seam-extension tracking

This directory tracks the plugin's proposal to extend the official `ctx.lsp` seam with the action
operations (`diagnostics` / `formatDocument` / `completion`).

## Status

| Date | Event |
| --- | --- |
| 2026-08-14 | Proposal submitted to upstream [Discussion #781](https://github.com/deepseek-ai/deepseek-harness/discussions/781) (issues/PRs disabled upstream at the time); fork branch `PerryLink/deepseek-harness:agent/lsp-action-seam` (commit `7f10651`), all gates green. |
| 2026-08-15 | `git apply --check upstream/lsp-action-seam.patch` against the current harness tree (`a0ab396`) passes cleanly: **34 files, +1201/−201**. The patch is still replayable; only the Discussion link and any upstream review feedback need to be folded in before opening a PR once upstream enables pull requests. |
| 2026-08-15 | The plugin's seam-first path now resolves `ctx.lsp` lazily per call (`src/runner.ts`, `src/index.ts`), so it works regardless of whether the seam loads before or after the plugin — no apply-time snapshot to go stale. |

## Re-verification procedure

```sh
cd <deepseek-harness checkout>
git apply --check <plugin>/upstream/lsp-action-seam.patch   # must exit 0 against the target tree
```

If the harness drifts and the check fails, regenerate the patch from the fork branch against the
new base (the fork keeps the proposal commits), update this table, and bump the verification date
here.

## Migration path once the seam lands

1. The runner's `trySeamAction` classification already handles the landed vocabulary: success
   routes through the seam; `LSP_UNSUPPORTED_OPERATION` fails loud; code-less errors (the pre-land
   seam) and `LSP_UNAVAILABLE` fall back to the built-in client.
2. Keep the built-in client as the standalone fallback for the `servers` table (the seam is an
   optional capability — compositions without `ctx.lsp` still work).
3. After a settling period, the plugin can drop `src/framing.ts` / `src/connection.ts` /
   `src/client.ts` internals in favor of `@deepseek-ai/dsh-lsp-stdio`'s host — the built-in
   client mirrors it, so the swap is contained to `client.ts` and `connection.ts`.
4. New extended operations (`codeAction`, `workspaceSymbol`, `documentSymbol`, `signatureHelp`,
   `inlayHint`) ride the built-in client today; propose them as a second upstream vocabulary
   extension when the first lands.

## Files

- `lsp-action-seam.patch` — the full proposal patch (replayable against the current tree).
- `PR-description.md` — the pull-request description ready for when upstream enables PRs.
