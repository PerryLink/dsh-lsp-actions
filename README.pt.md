<div align="center">

# 🛰️ dsh-lsp-actions

**A superfície de ação LSP para o DeepSeek Harness — servidores de linguagem reais, feedback real.**

Diagnósticos, formatação e completamento de código para o loop do editor do seu agente, alimentados pelos mesmos servidores de linguagem que o seu IDE usa.

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## O que este plugin dá ao seu agente

O seam oficial `ctx.lsp` do DeepSeek Harness cobre a **navegação** (ir para definição, referências, implementação, hover). O `dsh-lsp-actions` completa a **superfície de ação** — o ciclo de feedback que um agente precisa enquanto escreve e corrige código:

| Ferramenta | O que faz | Escreve? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | Erros, avisos e sugestões do compilador/analisador com severidade, intervalo, mensagem e servidor de origem | ❌ somente leitura |
| `lsp_format <file> [range?]` | Formata um arquivo ou seleção através do servidor de linguagem e aplica o resultado, devolvendo o diff | ✅ via `fs/write-intent` + política de sandbox |
| `lsp_completion <file> <line> <character>` | Sugestões de completamento em uma posição do cursor — **apenas referência**, nunca executadas | ❌ somente leitura |

> ✨ Uma execução real do `typescript-language-server` faz parte da suíte de testes: diagnósticos, formatação e completamento são verificados de ponta a ponta contra um servidor vivo, não apenas mocks.

## Início rápido

```sh
dsh plugin --profile <name> add <caminho-ou-tarball-do-dsh-lsp-actions>
```

Configure uma entrada por servidor de linguagem (o formato espelha a configuração oficial do `lsp-stdio`):

```yaml
# no cordis.patch.yml do seu perfil (ou na linha do bundle)
- insert:
    - id: lsp-actions
      name: dsh-lsp-actions
      inject: [tools, fs, subprocess]
      config:
        servers:
          ts:
            command: typescript-language-server
            args: [--stdio]
            extensionToLanguage:
              ".ts": typescript
            formattingOptions: { tabSize: 2, insertSpaces: true }
          py:
            command: pyright-langserver
            args: [--stdio]
            extensionToLanguage:
              ".py": python
        maxDiagnostics: 200
        maxCompletionItems: 20
        maxResultChars: 16000
        timeoutMs: 60000
```

Com a **tabela `servers` vazia e nenhum seam `ctx.lsp` montado, o plugin não contribui com nada** — ele nunca inicia servidores que você não configurou.

## Por que é seguro por construção

- **A formatação é uma mutação real, tratada como `write`/`edit`.** Cada byte passa pelo waterfall `fs/write-intent` (observação → escrita protegida → observação) e pela política de sandbox por chamada.
- **Sessões somente leitura falham alto, rápido e estruturado** — `LSP_ACTION_READ_ONLY` com o marcador compartilhado `[sandbox: …]`, lançado *antes* de qualquer ida e volta ao servidor.
- **A escalada corresponde às ferramentas oficiais.** Sob um sistema de arquivos confinado, o `lsp_format` anuncia a mesma nova tentativa única `sandbox_permissions` / `justification` do `write`/`edit`, resolvida via `ctx.approval`.
- **Conflitos nunca sobrescrevem dados.** Se o arquivo mudou em disco depois de lido, a escrita protegida falha com `LSP_ACTION_CONFLICT` e o modelo é orientado a escolher: reler e rodar de novo, ou aplicar o diff manualmente.
- **Os timeouts são da plataforma.** Cada ferramenta declara `timeoutMs`; a política oficial `dsh-tool-call-timeout-policy` o aplica, e cada espera respeita `exec.signal`.
- **Nada é armazenado em cache.** Resultados de diagnósticos/completamento vivem apenas no log da sessão; não há persistência entre sessões.
- **Servidores ruins falham alto.** Um executável ausente falha na carga; um servidor que morre na inicialização falha a chamada com `LSP_ACTION_SERVER_FAILED` mais o final do seu stderr.

## Arquitetura

As ações rodam **primeiro pelo seam oficial** e caem para o cliente stdio mínimo próprio do plugin:

```
lsp_diagnostics / lsp_format / lsp_completion
        │
        ▼
   seam ctx.lsp (estendido: diagnostics / formatDocument / completion)
        │  ausente · legado · sem provedor para este arquivo
        ▼
   cliente stdio integrado  ←  tabela servers (ctx.subprocess.spawn + JSON-RPC)
```

A extensão do seam está proposta upstream (`upstream/lsp-action-seam.patch`, descrição do PR em `upstream/PR-description.md`). Quando for mesclada, o plugin continua funcionando sem mudanças — o cliente integrado simplesmente deixa de ser usado. Notas completas de pesquisa e design: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Referência de configuração

```ts
interface Config {
  /** Servidores de linguagem nomeados; vazio = o plugin não ativa servidores. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // padrão 200
  maxCompletionItems?: number    // padrão 20
  maxResultChars?: number        // padrão 16000 (limite do resultado renderizado completo)
  maxDocumentBytes?: number      // padrão 4000000
  timeoutMs?: number             // padrão 60000 (aplicado pela política oficial de timeout)
}

interface LspServerEntry {
  command: string                        // executável, resolvido no PATH ao carregar
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // opcional; globs vencem o mapa de extensões
  args?: string[]                        // sem shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // resposta estática a workspace/configuration
  formattingOptions?: unknown            // ex. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // padrão 16000000
  maxStderrBytes?: number                // padrão 1000000
  killGraceMs?: number                   // padrão 2000
  shutdownTimeoutMs?: number             // padrão 5000
  diagnosticsSettleMs?: number           // padrão 2000 (janela de diagnósticos push-only)
}
```

## Desenvolvimento

```sh
pnpm install
pnpm test          # 105 testes: unitários + integração com servidor de fixture + e2e real com tsls
pnpm build         # gera lib/
```

## Licença

[Apache License 2.0](LICENSE)
