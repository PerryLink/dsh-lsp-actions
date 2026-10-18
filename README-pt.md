<div align="center">

# 🛰️ dsh-lsp-actions
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-lsp-actions` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**A superfície de ação LSP para o DeepSeek Harness — servidores de linguagem reais, feedback real e o backend de integração IDE para editores.**

*Diagnósticos, formatação, autocompletar, ações de código, símbolos, ajuda de assinatura, dicas embutidas e renomeação para o loop do editor do seu agente — mais o protocolo estável de ações para editores (`lsp.actions.*`) que permite a qualquer editor consumi-los diretamente.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-lsp-actions)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-lsp-actions.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-lsp-actions/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-lsp-actions/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-lsp-actions?label=version)](https://github.com/PerryLink/dsh-lsp-actions/releases)
[![npm version](https://img.shields.io/npm/v/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dm/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-lsp-actions?metric=downloads&lang=pt)](https://dshfind.com/pt/plugins/PerryLink/dsh-lsp-actions?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-lsp-actions
```


</div>

---

**📖 Base de conhecimento do ecossistema** — dados medidos, não marketing: [guia de desenvolvimento · dados de seleção · critérios de manutenção](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **git channel** (`main` mais recente): `dsh plugin --profile web add github:PerryLink/dsh-lsp-actions` — o script `prepare` compila (`tsc --noEmitOnError`).
- **npm channel** (versões publicadas): `dsh plugin --profile web add dsh-lsp-actions`.
- **tarball channel**: execute `pnpm pack` neste repo e depois `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (ou remova a linha do patch do perfil).

## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-lsp-actions?

A superfície de ação LSP para o DeepSeek Harness — servidores de linguagem reais, feedback real e o backend de integração IDE para editores.

Diagnósticos, formatação, autocompletar, ações de código, símbolos, ajuda de assinatura, dicas embutidas e renomeação para o loop do editor do seu agente — mais o protocolo estável de ações para editores (`lsp.actions.*`) que permite a qualquer editor consumi-los diretamente.

![Demonstração de terminal do dsh-lsp-actions: dsh-lsp-actions — install, then map servers per project](https://raw.githubusercontent.com/PerryLink/dsh-lsp-actions/main/docs/assets/dsh-lsp-actions-hero.png)

![Animated terminal demo of dsh-lsp-actions](https://raw.githubusercontent.com/PerryLink/dsh-lsp-actions/main/docs/assets/dsh-lsp-actions-demo.gif)

*A mesma execução, animada.*

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (compatibilidade declarada para `>=0.1.2-rc.1 <0.2.0 \|\| >=0.1.5-alpha.1 <0.2.0 \|\| >=0.1.6-0 <0.2.0 \|\| >=0.1.7-0 <0.2.0`); o plugin não grava eventos de sessão próprios - o host registra os eventos padrão tool/call + tool/result. O seam publicado ainda tem apenas as quatro operações legacy, então o plugin mantém o próprio cliente e registra esse vintage na primeira chamada de ação. Verificado em 2026-09-24 (typecheck duplo + suíte completa + portas self-contained/artifacts). |
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
dsh plugin --profile web add github:PerryLink/dsh-lsp-actions
```

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add github:PerryLink/dsh-lsp-actions

# or from npm (published releases)
dsh plugin --profile web add dsh-lsp-actions

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: lsp-actions'
```

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

Cada entrada de `servers` é um `LspServerEntry`: `command` (executável resolvido no PATH no carregamento) e `extensionToLanguage` (`".ts"` → `typescript`) são obrigatórios; os opcionais `fileGlobs`, `projectMarkers`, `args`, `env`, `initializationOptions`, `configuration`, `formattingOptions`, `maxMessageBytes`, `maxStderrBytes`, `killGraceMs`, `shutdownTimeoutMs`, `diagnosticsSettleMs`, `diagnosticsDebounceMs` e `idleTimeoutMs` (`0` = manter vivo o processo do servidor) ajustam o cliente stdio integrado.

O roteamento é determinístico e guiado pela configuração. Cada arquivo usa a primeira correspondência de: **(1)** uma entrada de `servers` cujos `fileGlobs` correspondam ao caminho; **(2)** o diretório ancestral mais próximo — subindo até a raiz do workspace — que contenha um arquivo de configuração de projeto declarado nos `projectMarkers` de alguma entrada, avaliado apenas entre as entradas que também mapeiam a extensão do arquivo; **(3)** a entrada cujo `extensionToLanguage` mapeia a extensão do arquivo, na ordem de configuração. Assim, um workspace com `apps/node-app/{package.json,tsconfig.json,src/main.ts}` e `apps/deno-app/{deno.json,src/main.ts}` serve cada `main.ts` com o servidor do seu próprio projeto: sem regras de caminho para manter e sem mudanças ao adicionar, renomear ou mover um projeto:

```yaml
servers:
  typescript:
    command: typescript-language-server
    args: ["--stdio"]
    extensionToLanguage: { ".ts": typescript, ".tsx": typescriptreact }
    projectMarkers: ["package.json", "tsconfig.json"]
  deno:
    command: deno
    args: ["lsp"]
    extensionToLanguage: { ".ts": typescript, ".tsx": typescriptreact }
    projectMarkers: ["deno.json", "deno.jsonc"]
```

Um marcador de projeto só decide entre servidores que já mapeiam a extensão do arquivo (nunca amplia os tipos de arquivo de uma entrada); a busca nunca sai da raiz do workspace, e a configuração de projeto de um diretório nunca se aplica a um diretório irmão. O passo **(1)** tem prioridade sobre um marcador de projeto: se os `fileGlobs` de uma entrada correspondem ao caminho, ela continua vencendo, então remova os globs de nível de projeto ao adotar `projectMarkers`; um glob `**/*.ts` remanescente continuará reivindicando esses arquivos. Estas regras regem o cliente stdio integrado; um provider do seam `ctx.lsp` montado decide seu próprio roteamento.

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

![Editor demo](docs/assets/dsh-lsp-actions-demo.gif)

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

## Interoperability with other DSH plugins

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins com mais estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de mais estrelas:

- **Sem colisão de nome de ferramenta.** Todas as ferramentas têm namespace; nenhuma ocupa um nome puro já pertencente a uma ferramenta embutida ou a outro plugin.
- **Sem colisão de chave de serviço.** Não fornece nenhuma chave de serviço, portanto não pode colidir em uma.
- **Sem colisão de slot.** Não registra nenhuma chave de slot de cliente, então não disputa um assento `shadows-shipped-ui`.
- **Sem colisão de rota HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão na camada de patch.** O patch do bundle apenas faz `insert` da própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Observa os eventos sensíveis à ordem `fs/write-intent` com `ctx.on()` — o registro de difusão do Cordis, onde cada listener executa e nenhum pode privar outro do turno. **Todos os listeners aqui delegam via `next()`**, então a cadeia nunca é curto-circuitada:

Evidência estática: `dsh-plugin-doctor` K10–K13 retornam `pass` em todas as verificações deste repositório.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `lsp`, `language-server`, `diagnostics`, `formatting`, `completion`, `code-action`, `symbols`, `signature-help`, `inlay-hints`, `rename`, `refactor`, `ide`, `editor`, `vscode`, `acp`, `json-rpc`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o cliente de ações LSP e o ciclo de vida do servidor, as oito ferramentas, o protocolo de ações para editores, os testes, a CI e a documentação em cinco idiomas.

## PerryLink DSH Plugin Family

Este projeto é um dos **87 plugins ativamente mantidos** do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro da família tem **95** plugins — **5 congelados**, **3 retirados** — e fica recolhido abaixo para que cada README mantenha uma primeira tela curta. Expanda para ver cada linha, com o motivo na coluna Status.

<details>
<summary>Expandir os 95 plugins</summary>

| Plugin | Uma linha | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.
