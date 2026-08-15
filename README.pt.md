<div align="center">

# 🛰️ dsh-lsp-actions

**A superfície de ação LSP para o DeepSeek Harness — servidores de linguagem reais, feedback real.**

Diagnósticos, formatação, autocompletar de código, correções rápidas, símbolos, ajuda de assinatura e dicas embutidas para o loop do editor do seu agente, alimentados pelos mesmos servidores de linguagem que o seu IDE usa.

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dw/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## O que este plugin dá ao seu agente

O seam oficial `ctx.lsp` do DeepSeek Harness cobre **navegação** (ir para definição, referências, implementação, hover). O `dsh-lsp-actions` completa a **superfície de ação** — o loop de feedback que um agente precisa enquanto escreve e corrige código:

| Ferramenta | O que faz | Grava? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | Erros, avisos e dicas do compilador/analisador com severidade, intervalo, mensagem e servidor de origem | ❌ somente leitura |
| `lsp_format <file> [range?]` | Formata um arquivo ou seleção pelo servidor de linguagem e aplica o resultado, devolvendo o diff | ✅ via `fs/write-intent` + política de sandbox |
| `lsp_completion <file> <line> <character>` | Sugestões de autocompletar em uma posição do cursor, incluindo o texto de inserção real | ❌ somente leitura |
| `lsp_code_action <file> [range?] [only?]` | Correções/refatorações verificadas pelo servidor (com suas edições) para um intervalo ou o primeiro diagnóstico | ❌ somente referência |
| `lsp_symbols <query?> <file_path?>` | Busca de símbolos por nome em todo o workspace, ou o esboço de símbolos de um arquivo | ❌ somente leitura |
| `lsp_signature <file> <line> <character>` | Ajuda de assinatura (parâmetros e documentação) dentro de uma chamada | ❌ somente leitura |
| `lsp_inlay_hints <file> [range?]` | Anotações de tipo e dicas de nomes de parâmetros do servidor | ❌ somente leitura |
| `lsp_rename <file> <line> <character> <new_name>` | Renomeação de símbolo verificada pelo servidor, aplicada em todo o workspace com diffs por arquivo | ✅ via `fs/write-intent` + política de sandbox |

> ✨ Uma execução real do `typescript-language-server` faz parte da suíte de testes: diagnósticos, formatação, autocompletar, busca de símbolos e renomeação são verificados de ponta a ponta contra um servidor vivo, não apenas com mocks. A suíte é autocontida (tsls é uma devDependency) e roda no CI com Node 22/24 em Linux, Windows e macOS.

## Início rápido

```sh
dsh plugin --profile <name> add <caminho-ou-tarball-do-dsh-lsp-actions>
```

Configure uma entrada por servidor de linguagem (a forma espelha a configuração oficial do `lsp-stdio`):

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
        maxCodeActions: 50
        maxSymbols: 100
        maxSignatures: 10
        maxInlayHints: 200
        maxResultChars: 16000
        timeoutMs: 60000
```

As oito ferramentas são sempre registradas. Com uma **tabela `servers` vazia e nenhum seam `ctx.lsp` montado, as chamadas falham em alto e bom som** com `LSP_ACTION_UNAVAILABLE` dizendo o que configurar — o plugin nunca inicia servidores que você não configurou. Um seam `ctx.lsp` montado **depois** deste plugin é detectado na próxima chamada (a detecção do seam é por chamada, então a ordem de carregamento não importa).

## Por que é seguro por construção

- **Formatação e renomeação são mutações reais, tratadas como `write`/`edit`.** Cada byte passa pelo waterfall `fs/write-intent` (observação → escrita protegida → observação) e pela política de sandbox de cada chamada. O `lsp_rename` faz o pré-voo de cada arquivo editado (contenção no workspace, verificação de sobreposição, leitura limitada por bytes) *antes* da primeira escrita, para que uma resposta ruim do servidor não deixe uma renomeação pela metade.
- **Todo o resto é somente leitura por design.** Ações de código, autocompletar, símbolos, assinaturas e dicas são reportados como material de referência; aplicá-los é decisão própria do modelo com write/edit. Formas de comando são reportadas e **nunca executadas**.
- **Sessões somente leitura falham em alto e bom som, rápido e estruturado** — `LSP_ACTION_READ_ONLY` com o marcador compartilhado `[sandbox: …]`, lançado *antes* de qualquer ida e volta com o servidor.
- **A escalada acompanha as ferramentas oficiais.** Sob um sistema de arquivos restritivo, o `lsp_format` e o `lsp_rename` anunciam a mesma nova tentativa única `sandbox_permissions` / `justification` que `write`/`edit`, resolvida por meio de `ctx.approval`.
- **Conflitos nunca sobrescrevem.** Se o arquivo mudou em disco depois de lido, a escrita protegida falha com `LSP_ACTION_CONFLICT` e o modelo é instruído a escolher: reler e repetir, ou aplicar o diff manualmente.
- **Os timeouts são da plataforma.** Cada ferramenta declara `timeoutMs`; a política oficial `dsh-tool-call-timeout-policy` o aplica, e cada await respeita `exec.signal`.
- **Nada é cacheado.** Os resultados vivem apenas no log da sessão; não há persistência entre sessões.
- **Servidores ruins falham em alto e bom som.** Um executável inexistente falha no carregamento; um servidor que morre na inicialização falha a chamada com `LSP_ACTION_SERVER_FAILED` mais o final do seu stderr (após uma nova tentativa com processo novo).

## Arquitetura

As ações vão **primeiro pelo seam oficial** e caem para o cliente stdio mínimo do próprio plugin:

```
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (estendido: diagnostics / formatDocument / completion)
        │  ausente · legado · sem provider para este arquivo
        ▼
   cliente stdio integrado  ←  tabela servers (ctx.subprocess.spawn + JSON-RPC)
```

A extensão do seam está proposta upstream (`upstream/lsp-action-seam.patch`, descrição do PR em `upstream/PR-description.md`). Quando for integrada, o plugin continua funcionando sem mudanças — o cliente integrado simplesmente deixa de ser usado. O cliente integrado permanece como fallback independente para a tabela `servers`. Notas completas de pesquisa e design: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md), [`upstream/README.md`](upstream/README.md).

## Referência de configuração

```ts
interface Config {
  /** Servidores de linguagem nomeados; vazio = o cliente próprio não serve nada. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // padrão 200
  maxCompletionItems?: number    // padrão 20
  maxCodeActions?: number        // padrão 50
  maxSymbols?: number            // padrão 100
  maxSignatures?: number         // padrão 10
  maxInlayHints?: number         // padrão 200
  maxResultChars?: number        // padrão 16000 (teto do resultado renderizado completo)
  maxDocumentBytes?: number      // padrão 4000000
  timeoutMs?: number             // padrão 60000 (aplicado pela política oficial de timeout)
}

interface LspServerEntry {
  command: string                        // executável, resolvido no PATH no carregamento
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // opcional; globs vencem o mapa de extensões
  args?: string[]                        // sem shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // forma de objeto responde workspace/configuration por seção
  formattingOptions?: unknown            // p. ex. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // padrão 16000000
  maxStderrBytes?: number                // padrão 1000000
  killGraceMs?: number                   // padrão 2000
  shutdownTimeoutMs?: number             // padrão 5000
  diagnosticsSettleMs?: number           // padrão 2000 (janela de diagnósticos só por push)
  diagnosticsDebounceMs?: number         // padrão 250 (período de calma após o último lote enviado)
  idleTimeoutMs?: number                 // padrão 0 (0 = manter o processo do servidor vivo)
}
```

### Códigos de erro

Cada falha carrega um `code` estável no resultado de erro; modelos e chamadores roteiam pelo código, nunca pelo texto da mensagem.

| Code | Significado |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | Nenhuma entrada de servidor nem provider do seam trata este arquivo. |
| `LSP_ACTION_UNSUPPORTED` | O servidor (ou o provider do seam) não anuncia a operação. |
| `LSP_ACTION_SERVER_FAILED` | O servidor falhou (com o final do seu stderr); falhas de inicialização tentam de novo uma vez. |
| `LSP_ACTION_MALFORMED_RESPONSE` | O servidor enviou uma carga estruturalmente inválida. |
| `LSP_ACTION_CONFLICT` | O arquivo mudou desde que foi lido, ou as edições do servidor se sobrepõem / saem dos limites / saem do workspace. |
| `LSP_ACTION_READ_ONLY` | O modo de sandbox da sessão proíbe a escrita da formatação/renomeação. |
| `LSP_ACTION_WORKSPACE_REQUIRED` | A sessão chamadora não tem um cwd de workspace para enraizar o servidor. |
| `LSP_ACTION_NO_SYMBOL` | O servidor não encontrou um símbolo renomeável na posição do cursor. |

### Versão de host suportada

O plugin declara os pacotes do DeepSeek Harness como **peer dependencies** (`@deepseek-ai/dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-subprocess`, `dsh-tools` ≥ `0.1.0-rc.6`), de modo que uma única cópia serve ao host e ao plugin. Testado contra `0.1.0-rc.6`.

### Limitações conhecidas

- **Documentos transitórios.** Cada ação abre o arquivo, executa uma requisição e o fecha de novo (igual ao host stdio oficial). Servidores baseados em projeto que exigem um arquivo aberto residente para requisições sem documento (o tsls recusa `workspace/symbol` sem um) são atendidos passando `file_path` para `lsp_symbols`, que mantém o arquivo de roteamento aberto durante aquela requisição. O tsls também responde `textDocument/signatureHelp` com `null` sob esse ciclo de vida; outros servidores (gopls, pyright, rust-analyzer) o atendem normalmente.
- **Formatação de intervalo exige o provider de intervalo do servidor.** Servidores que só anunciam formatação de documento completo falham requisições de intervalo com `LSP_ACTION_UNSUPPORTED`.
- **A renomeação aplica apenas edições de texto.** Operações de recursos (criar/excluir/renomear arquivos) na resposta de renomeação do servidor são recusadas com `LSP_ACTION_UNSUPPORTED`, e edições fora do workspace falham com `LSP_ACTION_CONFLICT` antes de qualquer escrita. Em servidores `utf-8`/`utf-32`, as posições de renomeação entre arquivos são decodificadas lendo cada arquivo editado; um arquivo editado ilegível falha a chamada como conflito em vez de decodificar mal as posições.

## Desenvolvimento

```sh
pnpm install
pnpm run lint        # oxlint sobre src/ e tests/
pnpm test            # mais de 240 testes: unidade + integração com servidor fixture + e2e real com tsls
pnpm run test:coverage   # portões: linhas/instruções/funções ≥ 90%, ramos ≥ 85%
pnpm build           # emite lib/
```

## Contribuidores

Obrigado a todos que contribuíram com este projeto:

- [PerryLink](https://github.com/PerryLink) — o plugin em si: o cliente de ações LSP e o ciclo de vida do servidor, as oito ferramentas, os testes, a CI e a documentação.

## License

[Apache License 2.0](LICENSE)
