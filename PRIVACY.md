# Privacy

`dsh-lsp-actions` is a local-first DeepSeek Harness plugin. It does not include analytics, telemetry, advertising or a hosted account.

## What it reads

- The source files you ask it to inspect.
- Workspace configuration and language-server settings needed to start a language server.
- Its own profile configuration and local logs.

## What it sends

- LSP requests and diagnostics go to the language servers **you configure** on the same machine.
- The plugin has no network permission of its own (`network:none` in its DSH permission manifest). Language servers may have their own network behavior; review the server you choose.
- Nothing is sent to PerryLink or a third-party service by this plugin.

## What it stores

- No user content is stored outside the workspace and the configured profile.
- The plugin does not create a remote copy of source code, diagnostics or command output.

## Marketplace channels

The 1024 Store, dshfind and DSH Market listings are directory entries. Installing through them uses npm; the plugin's runtime behavior is unchanged.

## Contact

Open an issue at <https://github.com/PerryLink/dsh-lsp-actions/issues> for a privacy question or a data-handling concern.
