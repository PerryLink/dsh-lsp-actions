#!/usr/bin/env node
/**
 * The editor-backend bin: boots `cordis.yml` and keeps the process alive until
 * stdin closes or a signal arrives. Stdout belongs to the editor action
 * protocol — nothing in this composition may log to stdout.
 *
 * Usage: node bin.mjs <path/to/cordis.yml>
 *        (or set DSH_CORDIS_CONFIG=<path>, which wins)
 */

import { existsSync } from 'node:fs'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh-lsp-editor-backend'
installFailLoud(NAME)

const fromEnv = process.env.DSH_CORDIS_CONFIG
const fromArgv = process.argv[2]
const requested = fromEnv !== undefined && fromEnv !== '' ? fromEnv : fromArgv
if (requested === undefined || requested === '') {
  process.stderr.write(`usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>, which wins); the config is required\n`)
  process.exit(1)
}
const configPath = resolveConfigPath(requested, undefined)
if (!existsSync(configPath)) {
  process.stderr.write(`${NAME}: configuration not found: ${configPath}\n`)
  process.exit(1)
}

const ctx = await boot(NAME, configPath)
let exiting = false
async function disposeAndExit(code) {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.stdin.on('end', () => { void disposeAndExit(0) })
process.on('SIGTERM', () => { void disposeAndExit(0) })
process.on('SIGINT', () => { void disposeAndExit(130) })
