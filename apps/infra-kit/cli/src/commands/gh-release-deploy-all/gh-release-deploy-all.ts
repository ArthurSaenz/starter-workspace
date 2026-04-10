import select from '@inquirer/select'
import process from 'node:process'
import { z } from 'zod'
import { $ } from 'zx'

import { getReleasePRsWithInfo } from 'src/integrations/gh'
import { commandEcho } from 'src/lib/command-echo'
import { ENVs } from 'src/lib/constants'
import { logger } from 'src/lib/logger'
import { detectReleaseType, formatBranchChoices, getJiraDescriptions } from 'src/lib/release-utils'
import type { ReleaseType } from 'src/lib/release-utils'
import type { ToolsExecutionResult } from 'src/types'

interface GhReleaseDeployAllArgs {
  version: string
  env: string
  skipTerraform?: boolean
}

/**
 * Deploy a release branch to an environment
 */
export const ghReleaseDeployAll = async (args: GhReleaseDeployAllArgs): Promise<ToolsExecutionResult> => {
  const { version, env, skipTerraform } = args

  commandEcho.start('release-deploy-all')

  let selectedReleaseBranch = '' // "release/v1.8.0"

  if (version) {
    selectedReleaseBranch = version === 'dev' ? 'dev' : `release/v${version}`
  } else {
    commandEcho.setInteractive()

    const releasePRsInfo = await getReleasePRsWithInfo()

    const branches = releasePRsInfo.map((pr) => {
      return pr.branch
    })

    const releaseTypes = new Map<string, ReleaseType>(
      releasePRsInfo.map((pr) => {
        return [pr.branch, detectReleaseType(pr.title)]
      }),
    )

    const descriptions = await getJiraDescriptions()

    selectedReleaseBranch = await select({
      message: '🌿 Select release branch',
      choices: [{ name: 'dev', value: 'dev' }, ...formatBranchChoices({ branches, descriptions, types: releaseTypes })],
    })
  }

  const selectedVersion = selectedReleaseBranch === 'dev' ? 'dev' : selectedReleaseBranch.replace('release/v', '')

  commandEcho.addOption('--version', selectedVersion)

  let selectedEnv = ''

  if (env) {
    selectedEnv = env
  } else {
    commandEcho.setInteractive()

    selectedEnv = await select({
      message: '🧪 Select environment',
      choices: ENVs.map((env) => {
        return {
          name: env,
          value: env,
        }
      }),
    })
  }

  commandEcho.addOption('--env', selectedEnv)

  if (!ENVs.includes(selectedEnv)) {
    logger.error(`❌ Invalid environment: ${selectedEnv}. Exiting...`)
    process.exit(1)
  }

  const shouldSkipTerraform = skipTerraform ?? false

  if (shouldSkipTerraform) {
    commandEcho.addOption('--skip-terraform', true)
  }

  try {
    $.quiet = true

    const skipTerraformFlag = shouldSkipTerraform ? ['-f', 'skip_terraform_deploy=true'] : []

    await $`gh workflow run deploy-all.yml --ref ${selectedReleaseBranch} -f environment=${selectedEnv} ${skipTerraformFlag}`

    $.quiet = false

    logger.info(
      `Successfully launched deploy-all workflow_dispatch for release branch: ${selectedReleaseBranch} and environment: ${selectedEnv}`,
    )

    commandEcho.print()

    const structuredContent = {
      releaseBranch: selectedReleaseBranch,
      version: selectedReleaseBranch.replace('release/v', ''),
      environment: selectedEnv,
      skipTerraformDeploy: shouldSkipTerraform,
      success: true,
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
  } catch (error: unknown) {
    logger.error({ error }, '❌ Error launching workflow')
    process.exit(1)
  }
}

// MCP Tool Registration
export const ghReleaseDeployAllMcpTool = {
  name: 'gh-release-deploy-all',
  description: 'Deploy a release branch to a specified environment',
  inputSchema: {
    version: z.string().describe('Version to deploy (e.g., "1.2.5")'),
    env: z.string().describe('Environment to deploy to (e.g., "dev", "renana", "oriana")'),
    skipTerraform: z.boolean().optional().describe('Skip terraform deployment step'),
  },
  outputSchema: {
    releaseBranch: z.string().describe('The release branch that was deployed'),
    version: z.string().describe('The version that was deployed'),
    environment: z.string().describe('The environment deployed to'),
    skipTerraformDeploy: z.boolean().describe('Whether terraform deployment was skipped'),
    success: z.boolean().describe('Whether the deployment was successful'),
  },
  handler: ghReleaseDeployAll,
}
