import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { z } from 'zod'

import {
  ENV_CLEAR_FILE,
  ENV_LOAD_FILE,
  INFRA_KIT_ENV_CONFIG_VAR,
  INFRA_KIT_ENV_LOADED_AT_VAR,
  INFRA_KIT_ENV_PROJECT_VAR,
  getSessionCacheDir,
  parseVarNamesFromEnvFile,
} from 'src/lib/constants'
import { logger } from 'src/lib/logger'
import type { ToolsExecutionResult } from 'src/types'

/**
 * Clear loaded env vars. Prints a file path to stdout that must be sourced to apply. The env-clear shell alias does this automatically.
 */
export const envClear = async (): Promise<ToolsExecutionResult> => {
  const cacheDir = getSessionCacheDir()
  const envLoadPath = path.join(cacheDir, ENV_LOAD_FILE)

  if (!fs.existsSync(envLoadPath)) {
    logger.error('No loaded environment found. Run `env-load` first.')

    return {
      content: [
        {
          type: 'text',
          text: 'No loaded environment found. Run `env-load` first.',
        },
      ],
    }
  }

  const varNames = parseVarNamesFromEnvFile(envLoadPath)

  // Build unset script
  const unsetLines = [
    ...varNames.map((v) => {
      return `unset ${v}`
    }),
    `unset ${INFRA_KIT_ENV_CONFIG_VAR}`,
    `unset ${INFRA_KIT_ENV_PROJECT_VAR}`,
    `unset ${INFRA_KIT_ENV_LOADED_AT_VAR}`,
  ]

  // Write unset script to cache
  const clearFilePath = path.resolve(cacheDir, ENV_CLEAR_FILE)

  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(clearFilePath, `${unsetLines.join('\n')}\n`)

  // REQUIRED
  process.stdout.write(`${clearFilePath}\n`)

  // Remove env load file so env-clear can detect "no env loaded" next time
  fs.unlinkSync(envLoadPath)

  const structuredContent = {
    variableCount: varNames.length,
    unsetStatements: unsetLines,
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  }
}

// MCP Tool Registration
export const envClearMcpTool = {
  name: 'env-clear',
  description:
    'Clear loaded env vars. Returns a file path that must be sourced (source <path>) to apply. The env-clear shell alias does this automatically.',
  inputSchema: {},
  outputSchema: {
    filePath: z.string().describe('Path to the file that must be sourced to apply'),
    variableCount: z.number().describe('Number of variables cleared'),
    unsetStatements: z.array(z.string()).describe('Unset statements generated'),
  },
  handler: envClear,
}
