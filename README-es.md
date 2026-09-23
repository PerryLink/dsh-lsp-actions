<div align="center">

# 🛰️ dsh-lsp-actions
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-lsp-actions` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**La superficie de acción LSP para DeepSeek Harness — servidores de lenguaje reales, retroalimentación real y el backend de integración IDE para editores.**

*Diagnósticos, formateo, completado, acciones de código, símbolos, ayuda de firmas, sugerencias insertadas y renombrado para el bucle de editor de tu agente — más el protocolo estable de acciones para editores (`lsp.actions.*`) que permite a cualquier editor consumirlos directamente.*

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
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-lsp-actions?metric=downloads&lang=es)](https://dshfind.com/es/plugins/PerryLink/dsh-lsp-actions?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.1.7-alpha.1` (compatibilidad declarada para `>=0.1.2-rc.1 <0.2.0 \|\| >=0.1.5-alpha.1 <0.2.0 \|\| >=0.1.6-0 <0.2.0 \|\| >=0.1.7-0 <0.2.0`); el plugin no escribe eventos de sesión propios - el host registra los eventos estándar tool/call + tool/result. El seam publicado aún solo tiene las cuatro operaciones legacy, así que el plugin conserva su propio cliente y registra ese vintage en la primera llamada de acción. Verificado el 2026-09-18 (doble typecheck + suite completa + puertas self-contained/artifacts). |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | Todas (host puro; subprocesos + sistema de archivos, sin red) |
| Model | Cualquiera (las herramientas son independientes del modelo; el plugin nunca llama a un modelo) |

## What you get

`dsh-lsp-actions` se monta como una única fila de host (`id: lsp-actions`, `name: dsh-lsp-actions`, `inject: [tools, fs, subprocess]`). El seam oficial `ctx.lsp` de DeepSeek Harness cubre la **navegación** (ir a definición, referencias, implementación, hover); este plugin completa la **superficie de acción**: el bucle de retroalimentación que un agente necesita mientras escribe y corrige código:

1. **Ocho herramientas `lsp_*`** — diagnósticos, formateo, completado, acciones de código, símbolos, ayuda de firmas, sugerencias insertadas y renombrado, todas servidas por los mismos servidores de lenguaje que usa tu IDE.
2. **Protocolo de acciones para editores v1** — una superficie JSON-RPC estable (`lsp.actions.list` / `lsp.actions.run` / `lsp.events`) que permite a cualquier editor (VS Code primero) consumir esas capacidades directamente.
3. **Verificación con servidor real** — una ejecución real de `typescript-language-server` forma parte de la suite de tests (autocontenida, CI en Node 22/24 en Linux, Windows y macOS), no solo mocks.

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

- **git channel** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"` — el script `prepare` compila (`tsc --noEmitOnError`).
- **npm channel** (versiones publicadas): `dsh plugin --profile web add dsh-lsp-actions`.
- **tarball channel**: ejecuta `pnpm pack` en este repo y luego `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (o quita la fila del patch del perfil).

## Configuration

Todos los ajustes son campos Schemastery `Config` (modificables desde cordis.yml). Una sobrescritura dirigida por id reemplaza toda la fila — repite cada clave que necesites. `cordis.patch.yml` documenta cada clave en línea.

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Servidores de lenguaje nombrados; una tabla vacía no activa ningún servidor |
| `editor.enabled` | `false` | Sirve el protocolo de acciones para editores por JSON-RPC stdio (solo backend headless) |
| `editor.requestTimeoutMs` | `60000` | Presupuesto de timeout por ejecución (ms) del protocolo de editor |
| `editor.diagnosticsCacheMaxFiles` | `64` | Tamaño de la caché LRU de diagnósticos (en archivos) |
| `maxDiagnostics` | `200` | Tope de diagnósticos por resultado |
| `maxCompletionItems` | `20` | Tope de elementos de completado por resultado |
| `maxCodeActions` | `50` | Tope de acciones de código por resultado |
| `maxSymbols` | `100` | Tope de resultados de símbolos |
| `maxSignatures` | `10` | Tope de ayuda de firmas |
| `maxInlayHints` | `200` | Tope de sugerencias insertadas |
| `maxResultChars` | `16000` | Tope del resultado renderizado (caracteres) |
| `maxDocumentBytes` | `4000000` | Tope de lectura de documento (bytes) |
| `timeoutMs` | `60000` | Timeout por llamada, aplicado por la política oficial de timeout |

Cada entrada de `servers` es un `LspServerEntry`: `command` (ejecutable resuelto en PATH al cargar) y `extensionToLanguage` (`".ts"` → `typescript`) son obligatorios; los opcionales `fileGlobs`, `projectMarkers`, `args`, `env`, `initializationOptions`, `configuration`, `formattingOptions`, `maxMessageBytes`, `maxStderrBytes`, `killGraceMs`, `shutdownTimeoutMs`, `diagnosticsSettleMs`, `diagnosticsDebounceMs` e `idleTimeoutMs` (`0` = mantener vivo el proceso del servidor) ajustan el cliente stdio integrado.

El enrutado es determinista y se rige por la configuración. Cada archivo toma la primera coincidencia de: **(1)** una entrada de `servers` cuyos `fileGlobs` coincidan con la ruta; **(2)** el directorio ancestro más cercano —subiendo hasta la raíz del workspace— que contenga un archivo de configuración de proyecto declarado en los `projectMarkers` de alguna entrada, evaluado solo entre las entradas que además mapean la extensión del archivo; **(3)** la entrada cuyo `extensionToLanguage` mapea la extensión del archivo, en orden de configuración. Así, un workspace con `apps/node-app/{package.json,tsconfig.json,src/main.ts}` y `apps/deno-app/{deno.json,src/main.ts}` sirve cada `main.ts` con el servidor de su propio proyecto: sin reglas de ruta que mantener y sin cambios al añadir, renombrar o mover un proyecto:

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

Un marcador de proyecto solo decide entre servidores que ya mapean la extensión del archivo (nunca amplía los tipos de archivo de una entrada); la búsqueda nunca sale de la raíz del workspace, y la configuración de proyecto de un directorio nunca se aplica a un directorio hermano. El paso **(1)** tiene prioridad sobre un marcador de proyecto: si los `fileGlobs` de una entrada coinciden con la ruta, esa entrada sigue ganando, así que elimina los globs de nivel de proyecto al adoptar `projectMarkers`; un glob `**/*.ts` persistente seguirá reclamando esos archivos. Estas reglas rigen el cliente stdio integrado; un provider del seam `ctx.lsp` montado decide su propio enrutado.

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `lsp_diagnostics` | tool | `<file>` — errores, advertencias y sugerencias del compilador/analizador con severidad, rango, mensaje y servidor de origen (solo lectura) |
| `lsp_format` | tool | `<file> [range?]` — formatea un archivo/selección mediante el servidor de lenguaje y lo aplica, devolviendo el diff (escribe vía `fs/write-intent`) |
| `lsp_completion` | tool | `<file> <line> <character>` — sugerencias de completado en una posición del cursor, incluido el texto de inserción (solo lectura) |
| `lsp_code_action` | tool | `<file> [range?] [only?]` — correcciones/refactorizaciones verificadas por el servidor con sus ediciones, para un rango o el primer diagnóstico (solo referencia) |
| `lsp_symbols` | tool | `<query?> <file_path?>` — búsqueda de símbolos por nombre en todo el workspace, o el esquema de un archivo (solo lectura) |
| `lsp_signature` | tool | `<file> <line> <character>` — ayuda de firmas (parámetros y documentación) dentro de una llamada (solo lectura) |
| `lsp_inlay_hints` | tool | `<file> [range?]` — anotaciones de tipo y sugerencias de nombres de parámetros del servidor (solo lectura) |
| `lsp_rename` | tool | `<file> <line> <character> <new_name>` — renombrado verificado por el servidor, aplicado en todo el workspace con diffs por archivo (escribe vía `fs/write-intent`) |
| `lsp.actions.*` | protocol | Protocolo de acciones para editores v1: `lsp.actions.list` / `lsp.actions.run` / `lsp.events` por JSON-RPC |
| `examples/vscode/` | extension | Extensión de VS Code solo-UI más la composición de backend headless a la que se conecta |

## Editor action protocol v1

Cuando se establece `editor.enabled: true` en una composición headless dedicada, `dsh-lsp-actions` sirve un protocolo de editor estable por JSON-RPC 2.0 delimitado por saltos de línea (el mismo encuadre de wire que los transportes oficiales SDK/ACP):

| Method | What it does |
|---|---|
| `lsp.actions.list` | Devuelve la versión de protocolo `lsp-actions/v1`, el catálogo de acciones (`diagnostics.get`, `completion.get`, `quickfix.apply`, `format` — cada una marcada `writes`) y las sesiones DSH direccionables |
| `lsp.actions.run` | Ejecuta una acción con un sobre estructurado `{ requestId, action, status, result \| error }`; los errores llevan los códigos estables `LSP_ACTION_*` |
| `lsp.events` | Se suscribe a las notificaciones `lsp.event` transmitidas: `diagnostics.updated`, `action.status`, `file.changed`, `sessions.changed` |

Todas las acciones de escritura (`quickfix.apply`, `format`) pasan por los **presets de permisos oficiales y la aprobación**: una sesión `read-only` es rechazada con `LSP_ACTION_READ_ONLY` antes de cualquier ida y vuelta con el servidor, las ediciones viajan por el waterfall `fs/write-intent` y el par de escalado `sandbox_permissions` + `justification` se resuelve mediante el `approveEscalation` oficial (fail-closed cuando no hay quién decida). Especificación de wire completa, bilingüe: [`docs/editor-protocol.md`](docs/editor-protocol.md) · [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md).

**Versionado y la promesa de compatibilidad hacia atrás**

- El protocolo está versionado — `lsp.actions.list` devuelve `protocol: "lsp-actions/v1"`, `version: 1`. **v1 está congelado:** los nombres de campos, ids de acción, tipos de evento y códigos de error se mantienen estables para siempre.
- La evolución es **solo aditiva**: nuevas acciones, campos y tipos de evento llegan sin subir la versión; la semántica existente nunca cambia en su sitio; un cambio que rompe compatibilidad se publica bajo una nueva versión de `protocol`, que los servidores pueden servir en paralelo.
- Los clientes deben ignorar campos, tipos de evento y acciones desconocidos, y enrutar por el `code` de error estable, nunca por el texto del mensaje.

**Códigos de error**

Cada fallo lleva un `code` estable; los modelos y llamadores enrutan por el código, nunca por el texto del mensaje.

| Code | Meaning |
|---|---|
| `LSP_ACTION_UNAVAILABLE` | Ninguna entrada de servidor ni provider del seam maneja este archivo |
| `LSP_ACTION_UNSUPPORTED` | El servidor (o el provider del seam) no anuncia la operación |
| `LSP_ACTION_SERVER_FAILED` | El servidor falló (con la cola de su stderr); los fallos de arranque reintentan una vez |
| `LSP_ACTION_MALFORMED_RESPONSE` | El servidor envió una carga estructuralmente inválida |
| `LSP_ACTION_CONFLICT` | El archivo cambió desde que se leyó, o las ediciones se solapan / salen de límites / salen del workspace |
| `LSP_ACTION_READ_ONLY` | El modo sandbox de la sesión prohíbe la escritura del formateo/renombrado |
| `LSP_ACTION_WORKSPACE_REQUIRED` | La sesión que llama no tiene un cwd de workspace donde enraizar el servidor |
| `LSP_ACTION_NO_SYMBOL` | El servidor no encontró un símbolo renombrable en la posición del cursor |
| `LSP_ACTION_UNKNOWN` | Protocolo de editor: id de acción desconocido, o ninguna acción de código coincidió con `title`/`index` |
| `LSP_ACTION_INVALID_ARGS` | Protocolo de editor: parámetros de acción mal formados |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | Protocolo de editor: la ruta de aprobación no pudo conceder un modo sandbox más amplio (fail-closed) |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | Protocolo de editor: la versión de protocolo declarada no es compatible |

## VS Code extension

[`examples/vscode/`](examples/vscode/) incluye una extensión **solo-UI** (barra lateral con las sesiones DSH, la lista de diagnósticos, aplicar quickfix con un clic, abrir en rango y formatear) más la composición de backend headless (`backend/cordis.yml`) a la que se conecta por JSON-RPC estilo ACP. La extensión implementa cero lógica LSP — cada capacidad y cada byte escrito pertenecen al plugin. Los pasos de instalación, ajustes y el script de grabación del gif de demostración están en [`examples/vscode/README.md`](examples/vscode/README.md).

![Editor demo](docs/editor-demo.gif)

## Permissions & data

- **Permisos**: el formateo y el renombrado viajan por los presets de permisos oficiales y la aprobación — el waterfall `fs/write-intent` y el par de escalado `sandbox_permissions` / `justification` resuelto mediante `ctx.approval`. El plugin declara `fs:read`, `fs:write`, `subprocess:spawn` y `network:none` en su manifiesto de workshop.
- **Datos**: no se almacena nada en disco; los resultados de las herramientas viven solo en el log de sesión (sin persistencia entre sesiones). El protocolo de editor mantiene una única caché LRU de diagnósticos en memoria, acotada, con sello de frescura y nunca persistida entre reinicios.
- **Sin red**: el plugin no hace peticiones de red; habla con los servidores de lenguaje por stdio de subprocesos locales.

## Security boundaries

- **Solo lectura por defecto.** Seis de las ocho herramientas son solo de referencia; únicamente `lsp_format` y `lsp_rename` mutan, y lo hacen como mutaciones reales de `write`/`edit`.
- **Seams oficiales, no reimplementados.** Cada byte pasa por el waterfall `fs/write-intent` (observación → escritura protegida → observación) y por la política sandbox de cada llamada; el escalado coincide con las herramientas oficiales `write`/`edit`.
- **Falla en voz alta, rápido y estructurado.** `servers` vacío + sin seam `ctx.lsp` → `LSP_ACTION_UNAVAILABLE`; sesiones de solo lectura → `LSP_ACTION_READ_ONLY` antes de cualquier ida y vuelta con el servidor; las formas de comando se reportan y nunca se ejecutan.
- **Los conflictos nunca pisan nada.** Un archivo cambiado en disco tras leerse falla con `LSP_ACTION_CONFLICT`; `lsp_rename` pre-vuela cada archivo editado antes de la primera escritura.
- **Trabajo acotado.** Los topes de resultados, los topes de bytes y la política de timeout de la plataforma acotan cada llamada; la caché de diagnósticos es una LRU acotada.
- **Nada se cachea en la ruta del modelo.** Los resultados de las herramientas viven solo en el log de sesión; la caché de diagnósticos nunca persiste entre reinicios.
- **Los servidores rotos fallan en voz alta.** Un ejecutable inexistente falla al cargar; un servidor que muere al arrancar falla la llamada con `LSP_ACTION_SERVER_FAILED` más la cola de su stderr (tras un reintento con proceso nuevo).
- **Higiene del prompt.** El plugin no inyecta persona ni prosa de prompt en el system prompt de la sesión — su superficie de cara al modelo son los ocho esquemas de herramientas.

## Architecture

Las acciones van **primero por el seam oficial** y caen al cliente stdio mínimo propio del plugin:

```text
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (extendido: diagnostics / formatDocument / completion)
        │  ausente · legado · sin provider para este archivo
        ▼
   cliente stdio integrado  ←  tabla servers (ctx.subprocess.spawn + JSON-RPC)
```

La extensión del seam está propuesta upstream (`upstream/lsp-action-seam.patch`, descripción del PR en `upstream/PR-description.md`). Cuando aterrice, el plugin sigue funcionando sin cambios — el cliente integrado simplemente deja de usarse. El cliente integrado se conserva como respaldo independiente para la tabla `servers`. El **protocolo de editor** usa el mismo runner, la misma ruta de escritura y la misma maquinaria de permisos. Notas completas de investigación y diseño: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Known limitations

- **Documentos transitorios.** Cada acción abre el archivo, ejecuta una petición y lo cierra de nuevo (igual que el host stdio oficial). Los servidores basados en proyecto que exigen un archivo abierto residente para peticiones sin documento (tsls rechaza `workspace/symbol` sin uno) se sirven pasando `file_path` a `lsp_symbols`. tsls también responde `textDocument/signatureHelp` con `null` bajo este ciclo de vida; otros servidores (gopls, pyright, rust-analyzer) lo sirven con normalidad.
- **El formateo de rango exige el provider de rango del servidor.** Los servidores que solo anuncian formateo de documento completo fallan las peticiones de rango con `LSP_ACTION_UNSUPPORTED`.
- **El renombrado solo aplica ediciones de texto.** Las operaciones de recursos (crear/borrar/renombrar archivos) en la respuesta de renombrado del servidor se rechazan con `LSP_ACTION_UNSUPPORTED`, y las ediciones fuera del workspace fallan como `LSP_ACTION_CONFLICT` antes de escribir nada.

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

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el cliente de acciones LSP y el ciclo de vida del servidor, las ocho herramientas, el protocolo de acciones para editores, los tests, la CI y la documentación en cinco idiomas.

## PerryLink DSH Plugin Family

This project is one of the **45 DeepSeek Harness plugins** maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-plugin-upgrade-015](https://github.com/PerryLink/dsh-plugin-upgrade-015)** | Merged `0.1.3-alpha.1` → `0.1.5-rc.1` upgrade corridor card plus a zero-dependency seam scanner | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |


## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.
