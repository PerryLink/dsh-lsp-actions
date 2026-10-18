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

```sh
dsh plugin --profile <name> add dsh-lsp-actions
```


</div>

---

**📖 Base de conocimiento del ecosistema** — datos medidos, no marketing: [guía de desarrollo · datos de selección · criterios de mantenimiento](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **git channel** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-lsp-actions` — el script `prepare` compila (`tsc --noEmitOnError`).
- **npm channel** (versiones publicadas): `dsh plugin --profile web add dsh-lsp-actions`.
- **tarball channel**: ejecuta `pnpm pack` en este repo y luego `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (o quita la fila del patch del perfil).

## ⭐ 如果它帮到了你

Este plugin forma parte de la [familia de plugins DSH](https://github.com/PerryLink) (más de 40, todos Apache-2.0). Si te resulta útil, **dale una estrella**: no desbloquea nada, pero ayuda a que la siguiente persona lo encuentre antes.

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-lsp-actions?

La superficie de acción LSP para DeepSeek Harness — servidores de lenguaje reales, retroalimentación real y el backend de integración IDE para editores.

Diagnósticos, formateo, completado, acciones de código, símbolos, ayuda de firmas, sugerencias insertadas y renombrado para el bucle de editor de tu agente — más el protocolo estable de acciones para editores (`lsp.actions.*`) que permite a cualquier editor consumirlos directamente.

![Demostración de terminal de dsh-lsp-actions: dsh-lsp-actions — install, then map servers per project](https://raw.githubusercontent.com/PerryLink/dsh-lsp-actions/main/docs/assets/dsh-lsp-actions-hero.png)

![Animated terminal demo of dsh-lsp-actions](https://raw.githubusercontent.com/PerryLink/dsh-lsp-actions/main/docs/assets/dsh-lsp-actions-demo.gif)

*La misma ejecución, animada.*

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (compatibilidad declarada para `>=0.1.2-rc.1 <0.2.0 \|\| >=0.1.5-alpha.1 <0.2.0 \|\| >=0.1.6-0 <0.2.0 \|\| >=0.1.7-0 <0.2.0`); el plugin no escribe eventos de sesión propios - el host registra los eventos estándar tool/call + tool/result. El seam publicado aún solo tiene las cuatro operaciones legacy, así que el plugin conserva su propio cliente y registra ese vintage en la primera llamada de acción. Verificado el 2026-09-24 (doble typecheck + suite completa + puertas self-contained/artifacts). |
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

![Editor demo](docs/assets/dsh-lsp-actions-demo.gif)

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

## Interoperability with other DSH plugins

Verificado contra **DSH `0.2.0-rc.2`** (el runtime para el que se publica este README) y el conjunto de plugins con más estrellas sondeado el 2026-10-05.

Este plugin **no interfiere** con otros plugins, incluidos los de más estrellas:

- **Sin colisión de nombres de herramienta.** Todas las herramientas llevan espacio de nombres; ninguna ocupa un nombre desnudo ya perteneciente a una herramienta incluida u otro plugin.
- **Sin colisión de clave de servicio.** No provee ninguna clave de servicio, así que no puede colisionar en una.
- **Sin colisión de slot.** No registra ninguna clave de slot de cliente, así que no disputa un asiento `shadows-shipped-ui`.
- **Sin colisión de ruta HTTP.** No registra ningún prefijo `webServer`.
- **Sin colisión en la capa de patch.** El patch del bundle solo hace `insert` de su propia fila; nunca sobrescribe el `config` de una fila incluida.
- **Sin mutación global.** No parchea prototipos, ni reescribe `process.env`, ni reemplaza el dispatcher global de fetch.

**Los listeners de eventos compartidos no interfieren por construcción.** Observa los eventos sensibles al orden `fs/write-intent` con `ctx.on()` — el registro de difusión de Cordis, donde cada listener se ejecuta y ninguno puede dejar sin turno a otro. **Todos los listeners aquí delegan por `next()`**, así que la cadena nunca se cortocircuita:

Evidencia estática: `dsh-plugin-doctor` K10–K13 dan `pass` en todas las comprobaciones de este repositorio.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `lsp`, `language-server`, `diagnostics`, `formatting`, `completion`, `code-action`, `symbols`, `signature-help`, `inlay-hints`, `rename`, `refactor`, `ide`, `editor`, `vscode`, `acp`, `json-rpc`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el cliente de acciones LSP y el ciclo de vida del servidor, las ocho herramientas, el protocolo de acciones para editores, los tests, la CI y la documentación en cinco idiomas.

## PerryLink DSH Plugin Family

Este proyecto es uno de los **87 plugins activamente mantenidos** de DeepSeek Harness de [PerryLink](https://github.com/PerryLink). El registro familiar tiene **95** plugins — **5 congelados**, **3 retirados** — y permanece plegado abajo para que cada README conserve una primera pantalla corta. Expándelo para ver cada fila, con el motivo en la columna Estado.

<details>
<summary>Expandir los 95 plugins</summary>

| Plugin | Una línea | Estado |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
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
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver el README del repositorio |
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

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.
