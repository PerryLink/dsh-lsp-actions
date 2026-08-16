<div align="center">

# 🛰️ dsh-lsp-actions

**La superficie de acción LSP para DeepSeek Harness — servidores de lenguaje reales, retroalimentación real.**

Diagnósticos, formateo, completado de código, correcciones rápidas, símbolos, ayuda de firmas y sugerencias insertadas para el bucle del editor de tu agente, impulsados por los mismos servidores de lenguaje que usa tu IDE.

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

> **Nuevo (v0.3.0):** backend de integración IDE — el protocolo de acciones para editores `lsp.actions.list` / `lsp.actions.run` / `lsp.events` (v1) y el ejemplo mínimo de VS Code. La especificación canónica del protocolo está documentada en [README.md](README.md) y [README.zh-CN.md](README.zh-CN.md) (arquitectura, versionado y compatibilidad hacia atrás); la especificación completa del wire: [docs/editor-protocol.md](docs/editor-protocol.md) / [docs/editor-protocol.zh-CN.md](docs/editor-protocol.zh-CN.md).

## Qué aporta este plugin a tu agente

El seam oficial `ctx.lsp` de DeepSeek Harness cubre la **navegación** (ir a definición, referencias, implementación, hover). `dsh-lsp-actions` completa la **superficie de acción**: el bucle de retroalimentación que un agente necesita mientras escribe y corrige código:

| Herramienta | Qué hace | ¿Escribe? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | Errores, advertencias y sugerencias del compilador/analizador con severidad, rango, mensaje y servidor de origen | ❌ solo lectura |
| `lsp_format <file> [range?]` | Formatea un archivo o selección mediante el servidor de lenguaje y aplica el resultado, devolviendo el diff | ✅ vía `fs/write-intent` + política sandbox |
| `lsp_completion <file> <line> <character>` | Sugerencias de completado en una posición del cursor, incluido el texto de inserción real | ❌ solo lectura |
| `lsp_code_action <file> [range?] [only?]` | Correcciones/refactorizaciones verificadas por el servidor (con sus ediciones) para un rango o el primer diagnóstico | ❌ solo referencia |
| `lsp_symbols <query?> <file_path?>` | Búsqueda de símbolos por nombre en todo el workspace, o el esquema de símbolos de un archivo | ❌ solo lectura |
| `lsp_signature <file> <line> <character>` | Ayuda de firmas (parámetros y documentación) dentro de una llamada | ❌ solo lectura |
| `lsp_inlay_hints <file> [range?]` | Anotaciones de tipo y sugerencias de nombres de parámetros del servidor | ❌ solo lectura |
| `lsp_rename <file> <line> <character> <new_name>` | Renombrado de símbolo verificado por el servidor, aplicado en todo el workspace con diffs por archivo | ✅ vía `fs/write-intent` + política sandbox |

> ✨ Una ejecución real de `typescript-language-server` forma parte de la suite de tests: diagnósticos, formateo, completado, búsqueda de símbolos y renombrado se verifican de extremo a extremo contra un servidor vivo, no solo con mocks. La suite es autocontenida (tsls es una devDependency) y corre en CI con Node 22/24 en Linux, Windows y macOS.

## Inicio rápido

```sh
dsh plugin --profile <name> add <ruta-o-tarball-de-dsh-lsp-actions>
```

Configura una entrada por servidor de lenguaje (la forma replica la configuración oficial de `lsp-stdio`):

```yaml
# en el cordis.patch.yml de tu perfil (o en la fila del bundle)
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

Las ocho herramientas se registran siempre. Con una **tabla `servers` vacía y ningún seam `ctx.lsp` montado, las llamadas fallan en voz alta** con `LSP_ACTION_UNAVAILABLE` indicando qué configurar — el plugin nunca arranca servidores que no configuraste. Un seam `ctx.lsp` montado **después** de este plugin se detecta en la siguiente llamada (la detección del seam es por llamada, así que el orden de carga no importa).

## Por qué es seguro por construcción

- **El formateo y el renombrado son mutaciones reales, tratadas como `write`/`edit`.** Cada byte pasa por el waterfall `fs/write-intent` (observación → escritura protegida → observación) y por la política sandbox de cada llamada. `lsp_rename` pre-vuela cada archivo editado (contención en el workspace, comprobación de solapamientos, lectura con tope de bytes) *antes* de la primera escritura, de modo que una respuesta mala del servidor no puede dejar un renombrado a medio aplicar.
- **Todo lo demás es de solo lectura por diseño.** Las acciones de código, completados, símbolos, firmas y sugerencias se reportan como material de referencia; aplicarlas es decisión propia del modelo con write/edit. Las formas de comando se reportan y **nunca se ejecutan**.
- **Las sesiones de solo lectura fallan en voz alta, rápido y estructurado** — `LSP_ACTION_READ_ONLY` con el marcador compartido `[sandbox: …]`, lanzado *antes* de cualquier ida y vuelta con el servidor.
- **La escalada coincide con las herramientas oficiales.** Bajo un sistema de archivos restrictivo, `lsp_format` y `lsp_rename` anuncian el mismo reintento único `sandbox_permissions` / `justification` que `write`/`edit`, resuelto mediante `ctx.approval`.
- **Los conflictos nunca pisan nada.** Si el archivo cambió en disco después de leerse, la escritura protegida falla con `LSP_ACTION_CONFLICT` y se le dice al modelo que elija: releer y repetir, o aplicar el diff manualmente.
- **Los timeouts son de la plataforma.** Cada herramienta declara `timeoutMs`; la política oficial `dsh-tool-call-timeout-policy` lo hace cumplir, y cada await respeta `exec.signal`.
- **No se cachea nada.** Los resultados viven solo en el log de sesión; no hay persistencia entre sesiones.
- **Los servidores rotos fallan en voz alta.** Un ejecutable inexistente falla al cargar; un servidor que muere al arrancar falla la llamada con `LSP_ACTION_SERVER_FAILED` más la cola de su stderr (tras un reintento con proceso nuevo).

## Arquitectura

Las acciones van **primero por el seam oficial** y caen al cliente stdio mínimo propio del plugin:

```
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (extendido: diagnostics / formatDocument / completion)
        │  ausente · legado · sin provider para este archivo
        ▼
   cliente stdio integrado  ←  tabla servers (ctx.subprocess.spawn + JSON-RPC)
```

La extensión del seam está propuesta upstream (`upstream/lsp-action-seam.patch`, descripción del PR en `upstream/PR-description.md`). Cuando aterrice, el plugin sigue funcionando sin cambios — el cliente integrado simplemente deja de usarse. El cliente integrado se conserva como respaldo independiente para la tabla `servers`. Notas completas de investigación y diseño: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md), [`upstream/README.md`](upstream/README.md).

## Referencia de configuración

```ts
interface Config {
  /** Servidores de lenguaje nombrados; vacío = el cliente propio no sirve nada. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // por defecto 200
  maxCompletionItems?: number    // por defecto 20
  maxCodeActions?: number        // por defecto 50
  maxSymbols?: number            // por defecto 100
  maxSignatures?: number         // por defecto 10
  maxInlayHints?: number         // por defecto 200
  maxResultChars?: number        // por defecto 16000 (tope del resultado renderizado completo)
  maxDocumentBytes?: number      // por defecto 4000000
  timeoutMs?: number             // por defecto 60000 (aplicado por la política oficial de timeout)
}

interface LspServerEntry {
  command: string                        // ejecutable, resuelto en PATH al cargar
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // opcional; los globs ganan al mapa de extensiones
  args?: string[]                        // sin shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // forma de objeto responde workspace/configuration por sección
  formattingOptions?: unknown            // p. ej. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // por defecto 16000000
  maxStderrBytes?: number                // por defecto 1000000
  killGraceMs?: number                   // por defecto 2000
  shutdownTimeoutMs?: number             // por defecto 5000
  diagnosticsSettleMs?: number           // por defecto 2000 (ventana de diagnósticos solo push)
  diagnosticsDebounceMs?: number         // por defecto 250 (período de calma tras el último lote empujado)
  idleTimeoutMs?: number                 // por defecto 0 (0 = mantener vivo el proceso del servidor)
}
```

### Códigos de error

Cada fallo lleva un `code` estable en el resultado de error; los modelos y llamadores enrutan por el código, nunca por el texto del mensaje.

| Code | Significado |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | Ninguna entrada de servidor ni provider del seam maneja este archivo. |
| `LSP_ACTION_UNSUPPORTED` | El servidor (o el provider del seam) no anuncia la operación. |
| `LSP_ACTION_SERVER_FAILED` | El servidor falló (con la cola de su stderr); los fallos de arranque reintentan una vez. |
| `LSP_ACTION_MALFORMED_RESPONSE` | El servidor envió una carga estructuralmente inválida. |
| `LSP_ACTION_CONFLICT` | El archivo cambió desde que se leyó, o las ediciones del servidor se solapan / salen de límites / salen del workspace. |
| `LSP_ACTION_READ_ONLY` | El modo sandbox de la sesión prohíbe la escritura del formateo/renombrado. |
| `LSP_ACTION_WORKSPACE_REQUIRED` | La sesión que llama no tiene un cwd de workspace donde enraizar el servidor. |
| `LSP_ACTION_NO_SYMBOL` | El servidor no encontró un símbolo renombrable en la posición del cursor. |

### Versión de host soportada

El plugin declara los paquetes de DeepSeek Harness como **peer dependencies** (`@deepseek-ai/dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-subprocess`, `dsh-tools` ≥ `0.1.0-rc.6`), de modo que una sola copia sirve al host y al plugin. Probado contra `0.1.0-rc.6`.

### Limitaciones conocidas

- **Documentos transitorios.** Cada acción abre el archivo, ejecuta una petición y lo cierra de nuevo (igual que el host stdio oficial). Los servidores basados en proyecto que exigen un archivo abierto residente para peticiones sin documento (tsls rechaza `workspace/symbol` sin uno) se sirven pasando `file_path` a `lsp_symbols`, que mantiene el archivo de enrutamiento abierto durante esa petición. tsls también responde `textDocument/signatureHelp` con `null` bajo este ciclo de vida; otros servidores (gopls, pyright, rust-analyzer) lo sirven con normalidad.
- **El formateo de rango exige el provider de rango del servidor.** Los servidores que solo anuncian formateo de documento completo fallan las peticiones de rango con `LSP_ACTION_UNSUPPORTED`.
- **El renombrado solo aplica ediciones de texto.** Las operaciones de recursos (crear/borrar/renombrar archivos) en la respuesta de renombrado del servidor se rechazan con `LSP_ACTION_UNSUPPORTED`, y las ediciones fuera del workspace fallan con `LSP_ACTION_CONFLICT` antes de escribir nada. En servidores `utf-8`/`utf-32`, las posiciones de renombrado entre archivos se decodifican leyendo cada archivo editado; un archivo editado ilegible falla la llamada como conflicto en lugar de decodificar mal las posiciones.

## Desarrollo

```sh
pnpm install
pnpm run lint        # oxlint sobre src/ y tests/
pnpm test            # más de 240 tests: unidad + integración con servidor fixture + e2e real con tsls
pnpm run test:coverage   # puertas: líneas/sentencias/funciones ≥ 90%, ramas ≥ 85%
pnpm build           # emite lib/
```

## Contribuidores

Gracias a todas las personas que han contribuido a este proyecto:

- [PerryLink](https://github.com/PerryLink) — el plugin en sí: el cliente de acciones LSP y el ciclo de vida del servidor, las ocho herramientas, los tests, la CI y la documentación.

## License

[Apache License 2.0](LICENSE)
