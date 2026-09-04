<div align="center">

# 🛰️ dsh-lsp-actions
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-lsp-actions` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**A superfície de ação LSP para o DeepSeek Harness — servidores de linguagem reais, feedback real e o backend de integração IDE para editores.**

*Diagnósticos, formatação, autocompletar, ações de código, símbolos, ajuda de assinatura, dicas embutidas e renomeação para o loop do editor do seu agente — mais o protocolo estável de ações para editores (`lsp.actions.*`) que permite a qualquer editor consumi-los diretamente.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-lsp-actions/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-lsp-actions/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-lsp-actions?label=version)](https://github.com/PerryLink/dsh-lsp-actions/releases)
[![npm version](https://img.shields.io/npm/v/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dm/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.2-rc.1` (compatibilidade declarada para `>=0.1.0-rc.8 <0.2.0`); o plugin não grava eventos de sessão próprios - o host registra os eventos padrão tool/call + tool/result. |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | Todas (host puro; subprocessos + sistema de arquivos, sem rede) |
| Model | Qualquer (as ferramentas são independentes do modelo; o plugin nunca chama um modelo) |

## What you get

O `dsh-lsp-actions` é montado como uma única linha de host (`id: lsp-actions`, `name: dsh-lsp-actions`, `inject: [tools, fs, subprocess]`). O seam oficial `ctx.lsp` do DeepSeek Harness cobre a **navegação** (ir para definição, referências, implementação, hover); este plugin completa a **superfície de ação** — o loop de feedback que um agente precisa enquanto escreve e corrige código:

1. **Oito ferramentas `lsp_*`** — diagnósticos, formatação, autocompletar, ações de código, símbolos, ajuda de assinatura, dicas embutidas e renomeação, todas servidas pelos mesmos servidores de linguagem que o seu IDE usa.
2. **Protocolo de ações para editores v1** — uma superfície JSON-RPC estável (`lsp.actions.list` / `lsp.actions.run` / `lsp.events`) que permite a qualquer editor (VS Code primeiro) consumir essas capacidades diretamente.
3. **Verificação com servidor real** — uma execução real do `typescript-language-server` faz parte da suíte de testes (autocontida, CI em Node 22/24 no Linux, Windows e macOS), não apenas mocks.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-lsp-actions

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: lsp-actions'
```

## Install & uninstall

- **git channel** (`main` mais recente): `dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"` — o script `prepare` compila (`tsc --noEmitOnError`).
- **npm channel** (versões publicadas): `dsh plugin --profile web add dsh-lsp-actions`.
- **tarball channel**: execute `pnpm pack` neste repo e depois `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (ou remova a linha do patch do perfil).

## Configuration

Todos os ajustes são campos Schemastery `Config` (alteráveis pelo cordis.yml). Uma sobrescrita direcionada por id substitui a linha inteira — repita cada chave de que precisar. O `cordis.patch.yml` documenta cada chave em linha.

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Servidores de linguagem nomeados; uma tabela vazia não ativa nenhum servidor |
| `editor.enabled` | `false` | Serve o protocolo de ações para editores por JSON-RPC stdio (somente backend headless) |
| `editor.requestTimeoutMs` | `60000` | Orçamento de timeout por execução (ms) do protocolo de editor |
| `editor.diagnosticsCacheMaxFiles` | `64` | Tamanho da cache LRU de diagnósticos (em arquivos) |
| `maxDiagnostics` | `200` | Teto de diagnósticos por resultado |
| `maxCompletionItems` | `20` | Teto de itens de autocompletar por resultado |
| `maxCodeActions` | `50` | Teto de ações de código por resultado |
| `maxSymbols` | `100` | Teto de resultados de símbolos |
| `maxSignatures` | `10` | Teto de ajuda de assinatura |
| `maxInlayHints` | `200` | Teto de dicas embutidas |
| `maxResultChars` | `16000` | Teto do resultado renderizado (caracteres) |
| `maxDocumentBytes` | `4000000` | Teto de leitura de documento (bytes) |
| `timeoutMs` | `60000` | Timeout por chamada, aplicado pela política oficial de timeout |

Cada entrada de `servers` é um `LspServerEntry`: `command` (executável resolvido no PATH no carregamento) e `extensionToLanguage` (`".ts"` → `typescript`) são obrigatórios; os opcionais `fileGlobs`, `args`, `env`, `initializationOptions`, `configuration`, `formattingOptions`, `maxMessageBytes`, `maxStderrBytes`, `killGraceMs`, `shutdownTimeoutMs`, `diagnosticsSettleMs`, `diagnosticsDebounceMs` e `idleTimeoutMs` (`0` = manter vivo o processo do servidor) ajustam o cliente stdio integrado.

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `lsp_diagnostics` | tool | `<file>` — erros, avisos e dicas do compilador/analisador com severidade, intervalo, mensagem e servidor de origem (somente leitura) |
| `lsp_format` | tool | `<file> [range?]` — formata um arquivo/seleção pelo servidor de linguagem e o aplica, devolvendo o diff (grava via `fs/write-intent`) |
| `lsp_completion` | tool | `<file> <line> <character>` — sugestões de autocompletar em uma posição do cursor, incluindo o texto de inserção (somente leitura) |
| `lsp_code_action` | tool | `<file> [range?] [only?]` — correções/refatorações verificadas pelo servidor com suas edições, para um intervalo ou o primeiro diagnóstico (somente referência) |
| `lsp_symbols` | tool | `<query?> <file_path?>` — busca de símbolos por nome em todo o workspace, ou o esboço de um arquivo (somente leitura) |
| `lsp_signature` | tool | `<file> <line> <character>` — ajuda de assinatura (parâmetros e documentação) dentro de uma chamada (somente leitura) |
| `lsp_inlay_hints` | tool | `<file> [range?]` — anotações de tipo e dicas de nomes de parâmetros do servidor (somente leitura) |
| `lsp_rename` | tool | `<file> <line> <character> <new_name>` — renomeação verificada pelo servidor, aplicada em todo o workspace com diffs por arquivo (grava via `fs/write-intent`) |
| `lsp.actions.*` | protocol | Protocolo de ações para editores v1: `lsp.actions.list` / `lsp.actions.run` / `lsp.events` por JSON-RPC |
| `examples/vscode/` | extension | Extensão VS Code somente-UI mais a composição de backend headless à qual se conecta |

## Editor action protocol v1

Quando `editor.enabled: true` é definido em uma composição headless dedicada, o `dsh-lsp-actions` serve um protocolo de editor estável por JSON-RPC 2.0 delimitado por quebras de linha (o mesmo enquadramento de wire dos transportes oficiais SDK/ACP):

| Method | What it does |
|---|---|
| `lsp.actions.list` | Devolve a versão de protocolo `lsp-actions/v1`, o catálogo de ações (`diagnostics.get`, `completion.get`, `quickfix.apply`, `format` — cada uma marcada `writes`) e as sessões DSH endereçáveis |
| `lsp.actions.run` | Executa uma ação com um envelope estruturado `{ requestId, action, status, result \| error }`; os erros carregam os códigos estáveis `LSP_ACTION_*` |
| `lsp.events` | Assina as notificações `lsp.event` transmitidas: `diagnostics.updated`, `action.status`, `file.changed`, `sessions.changed` |

Todas as ações de escrita (`quickfix.apply`, `format`) passam pelos **presets de permissão oficiais e pela aprovação**: uma sessão `read-only` é recusada com `LSP_ACTION_READ_ONLY` antes de qualquer ida e volta com o servidor, as edições viajam pelo waterfall `fs/write-intent` e o par de escalada `sandbox_permissions` + `justification` se resolve pelo `approveEscalation` oficial (fail-closed quando ninguém pode decidir). Especificação de wire completa, bilíngue: [`docs/editor-protocol.md`](docs/editor-protocol.md) · [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md).

**Versionamento e a promessa de compatibilidade retroativa**

- O protocolo é versionado — `lsp.actions.list` devolve `protocol: "lsp-actions/v1"`, `version: 1`. **O v1 está congelado:** nomes de campos, ids de ação, tipos de evento e códigos de erro permanecem estáveis para sempre.
- A evolução é **apenas aditiva**: novas ações, campos e tipos de evento chegam sem subir a versão; a semântica existente nunca muda no lugar; uma mudança que quebra compatibilidade é publicada sob uma nova versão de `protocol`, que os servidores podem servir lado a lado.
- Os clientes devem ignorar campos, tipos de evento e ações desconhecidos, e rotear pelo `code` de erro estável, nunca pelo texto da mensagem.

**Códigos de erro**

Cada falha carrega um `code` estável; modelos e chamadores roteiam pelo código, nunca pelo texto da mensagem.

| Code | Meaning |
|---|---|
| `LSP_ACTION_UNAVAILABLE` | Nenhuma entrada de servidor nem provider do seam trata este arquivo |
| `LSP_ACTION_UNSUPPORTED` | O servidor (ou o provider do seam) não anuncia a operação |
| `LSP_ACTION_SERVER_FAILED` | O servidor falhou (com o final do seu stderr); falhas de inicialização tentam de novo uma vez |
| `LSP_ACTION_MALFORMED_RESPONSE` | O servidor enviou uma carga estruturalmente inválida |
| `LSP_ACTION_CONFLICT` | O arquivo mudou desde que foi lido, ou as edições se sobrepõem / saem dos limites / saem do workspace |
| `LSP_ACTION_READ_ONLY` | O modo sandbox da sessão proíbe a escrita da formatação/renomeação |
| `LSP_ACTION_WORKSPACE_REQUIRED` | A sessão chamadora não tem um cwd de workspace para enraizar o servidor |
| `LSP_ACTION_NO_SYMBOL` | O servidor não encontrou um símbolo renomeável na posição do cursor |
| `LSP_ACTION_UNKNOWN` | Protocolo de editor: id de ação desconhecido, ou nenhuma ação de código coincidiu com `title`/`index` |
| `LSP_ACTION_INVALID_ARGS` | Protocolo de editor: parâmetros de ação mal formados |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | Protocolo de editor: a rota de aprovação não pôde conceder um modo sandbox mais amplo (fail-closed) |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | Protocolo de editor: a versão de protocolo declarada não é suportada |

## VS Code extension

[`examples/vscode/`](examples/vscode/) inclui uma extensão **somente-UI** (barra lateral com as sessões DSH, a lista de diagnósticos, aplicar quickfix com um clique, abrir no intervalo e formatar) mais a composição de backend headless (`backend/cordis.yml`) à qual se conecta por JSON-RPC estilo ACP. A extensão implementa zero lógica LSP — cada capacidade e cada byte escrito pertencem ao plugin. Os passos de instalação, ajustes e o script de gravação do gif de demonstração estão em [`examples/vscode/README.md`](examples/vscode/README.md).

![Editor demo](docs/editor-demo.gif)

## Permissions & data

- **Permissões**: a formatação e a renomeação viajam pelos presets de permissão oficiais e pela aprovação — o waterfall `fs/write-intent` e o par de escalada `sandbox_permissions` / `justification` resolvido por `ctx.approval`. O plugin declara `fs:read`, `fs:write`, `subprocess:spawn` e `network:none` em seu manifesto de workshop.
- **Dados**: nada é armazenado em disco; os resultados das ferramentas vivem apenas no log da sessão (sem persistência entre sessões). O protocolo de editor mantém uma única cache LRU de diagnósticos em memória, limitada, com selo de frescor e nunca persistida entre reinícios.
- **Sem rede**: o plugin não faz requisições de rede; ele fala com os servidores de linguagem por stdio de subprocessos locais.

## Security boundaries

- **Somente leitura por padrão.** Seis das oito ferramentas são apenas de referência; somente `lsp_format` e `lsp_rename` mutam, e o fazem como mutações reais de `write`/`edit`.
- **Seams oficiais, não reimplementados.** Cada byte passa pelo waterfall `fs/write-intent` (observação → escrita protegida → observação) e pela política sandbox de cada chamada; a escalada acompanha as ferramentas oficiais `write`/`edit`.
- **Falha em alto e bom som, rápido e estruturado.** `servers` vazio + sem seam `ctx.lsp` → `LSP_ACTION_UNAVAILABLE`; sessões somente leitura → `LSP_ACTION_READ_ONLY` antes de qualquer ida e volta com o servidor; formas de comando são reportadas e nunca executadas.
- **Conflitos nunca sobrescrevem.** Um arquivo mudado em disco após a leitura falha com `LSP_ACTION_CONFLICT`; o `lsp_rename` faz o pré-voo de cada arquivo editado antes da primeira escrita.
- **Trabalho limitado.** Os tetos de resultados, os tetos de bytes e a política de timeout da plataforma limitam cada chamada; a cache de diagnósticos é uma LRU limitada.
- **Nada é cacheado no caminho do modelo.** Os resultados das ferramentas vivem apenas no log da sessão; a cache de diagnósticos nunca persiste entre reinícios.
- **Servidores ruins falham em alto e bom som.** Um executável inexistente falha no carregamento; um servidor que morre na inicialização falha a chamada com `LSP_ACTION_SERVER_FAILED` mais o final do seu stderr (após uma nova tentativa com processo novo).
- **Higiene do prompt.** O plugin não injeta persona nem prosa de prompt no system prompt da sessão — sua superfície de cara ao modelo são os oito esquemas de ferramentas.

## Architecture

As ações vão **primeiro pelo seam oficial** e caem para o cliente stdio mínimo do próprio plugin:

```text
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (estendido: diagnostics / formatDocument / completion)
        │  ausente · legado · sem provider para este arquivo
        ▼
   cliente stdio integrado  ←  tabela servers (ctx.subprocess.spawn + JSON-RPC)
```

A extensão do seam está proposta upstream (`upstream/lsp-action-seam.patch`, descrição do PR em `upstream/PR-description.md`). Quando for integrada, o plugin continua funcionando sem mudanças — o cliente integrado simplesmente deixa de ser usado. O cliente integrado permanece como fallback independente para a tabela `servers`. O **protocolo de editor** usa o mesmo runner, o mesmo caminho de escrita e a mesma maquinaria de permissões. Notas completas de pesquisa e design: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Known limitations

- **Documentos transitórios.** Cada ação abre o arquivo, executa uma requisição e o fecha de novo (igual ao host stdio oficial). Servidores baseados em projeto que exigem um arquivo aberto residente para requisições sem documento (o tsls recusa `workspace/symbol` sem um) são atendidos passando `file_path` para `lsp_symbols`. O tsls também responde `textDocument/signatureHelp` com `null` sob esse ciclo de vida; outros servidores (gopls, pyright, rust-analyzer) o atendem normalmente.
- **A formatação de intervalo exige o provider de intervalo do servidor.** Servidores que só anunciam formatação de documento completo falham requisições de intervalo com `LSP_ACTION_UNSUPPORTED`.
- **A renomeação aplica apenas edições de texto.** Operações de recursos (criar/excluir/renomear arquivos) na resposta de renomeação do servidor são recusadas com `LSP_ACTION_UNSUPPORTED`, e edições fora do workspace falham como `LSP_ACTION_CONFLICT` antes de qualquer escrita.

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run lint           # oxlint over src/ and tests/
pnpm test               # vitest: unit + fixture-server integration + editor-protocol e2e + real tsls e2e
pnpm run test:coverage  # coverage gate
pnpm build              # tsc --noEmitOnError → lib/
pnpm run prepare        # tsc --noEmitOnError (runs on install)
pnpm run prepublishOnly # tsc --noEmitOnError (runs before publish)
```

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `lsp`, `language-server`, `diagnostics`, `formatting`, `completion`, `code-action`, `symbols`, `signature-help`, `inlay-hints`, `rename`, `refactor`, `ide`, `editor`, `vscode`, `acp`, `json-rpc`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o cliente de ações LSP e o ciclo de vida do servidor, as oito ferramentas, o protocolo de ações para editores, os testes, a CI e a documentação em cinco idiomas.

## PerryLink DSH Plugin Family

Este projeto é um dos [33 plugins de DeepSeek Harness](https://github.com/PerryLink) mantidos por [PerryLink](https://github.com/PerryLink). Se este ajuda você, os outros provavelmente também:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Auto-revisão de segundo modelo na cadeia de aprovação, com falha fechada por padrão | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Agentes filhos em segundo plano duráveis com barra lateral de UI web, mensagens e interrupção | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Governança de custos para DeepSeek Harness: orçamentos, carbono e latência em um painel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de uso único | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migre sessões, memória, habilidades e CLAUDE.md do Claude Code para o DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Controle de desktop nativo multiplataforma para DeepSeek Harness — Windows primeiro. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Verificações de qualidade de datasets e verificação de citações (a ponte numérica opcional consumida aqui) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Defesa contra injeção de prompt, jailbreak e vazamento de segredos para DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Guardião de disciplina de engenharia: sabatina de requisitos, portões de teste, revisão adversária | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Roteamento unificado de geração de imagens estáticas para DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Diagnóstico de desempenho só de leitura para DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Relatórios de pesquisa deterministas para fundos mútuos públicos chineses | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | Integração de PR/issues do GitHub para o DSH, cada escrita controlada por aprovação | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Orquestração de pesquisa setorial que sela as suas entregas através do `ctx.researchReport.assemble` deste plugin | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Base de conhecimento documental local para DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Integração de modelos locais (Ollama) para DeepSeek Harness. | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | Middleware de mascaramento de PII: anonimiza no limite do modelo, restaura na camada de exibição | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Painel de tempo de execução MCP somente leitura: comando /mcp + aba Settings com status, ferramentas e erros | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Memória entre sessões controlada por aprovação: costura ctx.memory + SQLite + ferramenta de memória | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | Exportador de observabilidade OpenTelemetry e Langfuse para DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Troca de estilo em tempo de execução equivalente ao outputStyles do Claude Code | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Regras de permissão declarativas allow/deny/ask estilo Claude Code com auditoria | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Base de conhecimento de desenvolvimento de plugins como habilidade de agente sob demanda | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Motor de relatórios de pesquisa verificáveis com evidência endereçada por conteúdo | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Pontuação de qualidade multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Fixe sessões na barra lateral web com ordenação durável | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Sincronização de sessões entre dispositivos para DeepSeek Harness — um espelho git dedicado do seu armazenamento de sessões. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Pacote de habilidades de auditoria de segurança: varredura de segredos, revisão de dependências e cadeia de suprimentos | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Loop de sessão com voz para DeepSeek Harness: fale e ouça a resposta. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Test drives isolados de instalação e smoke para plugins de DeepSeek Harness. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Tradução de parâmetros entre fornecedores e reparo determinístico de JSON para DeepSeek Harness. | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.
