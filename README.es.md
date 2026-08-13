<div align="center">

# 🛰️ dsh-lsp-actions

**La superficie de acción LSP para DeepSeek Harness — servidores de lenguaje reales, retroalimentación real.**

Diagnósticos, formateo y completado de código para el bucle del editor de tu agente, impulsados por los mismos servidores de lenguaje que usa tu IDE.

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## Qué aporta este plugin a tu agente

El seam oficial `ctx.lsp` de DeepSeek Harness cubre la **navegación** (ir a definición, referencias, implementación, hover). `dsh-lsp-actions` completa la **superficie de acción**: el bucle de retroalimentación que un agente necesita mientras escribe y corrige código:

| Herramienta | Qué hace | ¿Escribe? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | Errores, advertencias y sugerencias del compilador/analizador con severidad, rango, mensaje y servidor de origen | ❌ solo lectura |
| `lsp_format <file> [range?]` | Formatea un archivo o selección mediante el servidor de lenguaje y aplica el resultado, devolviendo el diff | ✅ vía `fs/write-intent` + política sandbox |
| `lsp_completion <file> <line> <character>` | Sugerencias de completado en una posición del cursor — **solo de referencia**, nunca se ejecutan | ❌ solo lectura |

> ✨ Una ejecución real de `typescript-language-server` forma parte de la suite de tests: diagnósticos, formateo y completado se verifican de extremo a extremo contra un servidor vivo, no solo con mocks.

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
        maxResultChars: 16000
        timeoutMs: 60000
```

Con la **tabla `servers` vacía y sin seam `ctx.lsp` montado, el plugin no aporta nada**: nunca inicia servidores que no hayas configurado.

## Por qué es seguro por construcción

- **El formateo es una mutación real, tratada como `write`/`edit`.** Cada byte pasa por el waterfall `fs/write-intent` (observación → escritura protegida → observación) y por la política sandbox por llamada.
- **Las sesiones de solo lectura fallan fuerte, rápido y estructurado** — `LSP_ACTION_READ_ONLY` con el marcador compartido `[sandbox: …]`, lanzado *antes* de cualquier ida y vuelta con el servidor.
- **La escalada coincide con las herramientas oficiales.** Bajo un sistema de archivos confinado, `lsp_format` anuncia el mismo reintento único `sandbox_permissions` / `justification` que `write`/`edit`, resuelto mediante `ctx.approval`.
- **Los conflictos nunca pisan datos.** Si el archivo cambió en disco después de leerse, la escritura protegida falla con `LSP_ACTION_CONFLICT` y se le indica al modelo que elija: releer y reintentar, o aplicar el diff manualmente.
- **Los timeouts son de la plataforma.** Cada herramienta declara `timeoutMs`; la política oficial `dsh-tool-call-timeout-policy` lo aplica, y cada espera respeta `exec.signal`.
- **No se guarda nada en caché.** Los resultados de diagnósticos/completado viven solo en el log de sesión; no hay persistencia entre sesiones.
- **Los servidores rotos fallan fuerte.** Un ejecutable inexistente falla en la carga; un servidor que muere al arrancar falla la llamada con `LSP_ACTION_SERVER_FAILED` más su cola de stderr.

## Arquitectura

Las acciones se ejecutan **primero por el seam oficial** y caen al cliente stdio mínimo propio del plugin:

```
lsp_diagnostics / lsp_format / lsp_completion
        │
        ▼
   seam ctx.lsp (extendido: diagnostics / formatDocument / completion)
        │  ausente · heredado · sin proveedor para este archivo
        ▼
   cliente stdio integrado  ←  tabla servers (ctx.subprocess.spawn + JSON-RPC)
```

La extensión del seam está propuesta upstream (`upstream/lsp-action-seam.patch`, descripción del PR en `upstream/PR-description.md`). Cuando se fusione, el plugin seguirá funcionando sin cambios — el cliente integrado simplemente dejará de usarse. Notas completas de investigación y diseño: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Referencia de configuración

```ts
interface Config {
  /** Servidores de lenguaje nombrados; vacío = el plugin no activa servidores. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // por defecto 200
  maxCompletionItems?: number    // por defecto 20
  maxResultChars?: number        // por defecto 16000 (límite del resultado renderizado completo)
  maxDocumentBytes?: number      // por defecto 4000000
  timeoutMs?: number             // por defecto 60000 (aplicado por la política oficial de timeouts)
}

interface LspServerEntry {
  command: string                        // ejecutable, resuelto en PATH al cargar
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // opcional; los globs ganan al mapa de extensiones
  args?: string[]                        // sin shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // respuesta estática a workspace/configuration
  formattingOptions?: unknown            // p. ej. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // por defecto 16000000
  maxStderrBytes?: number                // por defecto 1000000
  killGraceMs?: number                   // por defecto 2000
  shutdownTimeoutMs?: number             // por defecto 5000
  diagnosticsSettleMs?: number           // por defecto 2000 (ventana de diagnósticos push-only)
}
```

## Desarrollo

```sh
pnpm install
pnpm test          # 105 tests: unitarios + integración con servidor de prueba + e2e real con tsls
pnpm build         # genera lib/
```

## Licencia

[Apache License 2.0](LICENSE)
