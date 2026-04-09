import select from '@inquirer/select'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import yaml from 'yaml'
import { z } from 'zod'
import { $ } from 'zx'

import { getReleasePRsWithInfo } from 'src/integrations/gh'
import { commandEcho } from 'src/lib/command-echo'
import { ENVs } from 'src/lib/constants'
import { getProjectRoot } from 'src/lib/git-utils'
import { logger } from 'src/lib/logger'
import { detectReleaseType, formatBranchChoices, getJiraDescriptions } from 'src/lib/release-utils'
import type { ReleaseType } from 'src/lib/release-utils'
import type { ToolsExecutionResult } from 'src/types'

interface GhReleaseDeployServiceArgs {
  version: string
  env: string
  service: string
  skipTerraform?: boolean
}

/**
 * Deploy a specific service in a release branch to an environment
 */
export const ghReleaseDeployService = async (args: GhReleaseDeployServiceArgs): Promise<ToolsExecutionResult> => {
  const { version, env, service, skipTerraform } = args

  commandEcho.start('release-deploy-service')

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

  // Parse available services from workflow file
  const availableServices = await parseServicesFromWorkflow()

  let selectedService = ''

  if (service) {
    selectedService = service
  } else {
    commandEcho.setInteractive()

    selectedService = await select({
      message: '🚀 Select service to deploy',
      choices: availableServices.map((svc) => {
        return {
          name: svc,
          value: svc,
        }
      }),
    })
  }

  commandEcho.addOption('--service', selectedService)

  if (!availableServices.includes(selectedService)) {
    logger.error(`❌ Invalid service: ${selectedService}. Available services: ${availableServices.join(', ')}`)
    process.exit(1)
  }

  const shouldSkipTerraform = skipTerraform ?? false

  if (shouldSkipTerraform) {
    commandEcho.addOption('--skip-terraform', true)
  }

  try {
    $.quiet = true

    const skipTerraformFlag = shouldSkipTerraform ? ['-f', 'skip_terraform_deploy=true'] : []

    await $`gh workflow run deploy-single-service.yml --ref ${selectedReleaseBranch} -f environment=${selectedEnv} -f service=${selectedService} ${skipTerraformFlag}`

    $.quiet = false

    logger.info(
      `Successfully launched deploy-single-service workflow_dispatch for release branch: ${selectedReleaseBranch}, environment: ${selectedEnv}, service: ${selectedService}`,
    )

    commandEcho.print()

    const structuredContent = {
      releaseBranch: selectedReleaseBranch,
      version: selectedReleaseBranch.replace('release/v', ''),
      environment: selectedEnv,
      service: selectedService,
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

/**
 * Parse available services from the workflow file
 */
const parseServicesFromWorkflow = async (): Promise<string[]> => {
  const projectRoot = await getProjectRoot()
  const workflowPath = resolve(projectRoot, '.github/workflows/deploy-single-service.yml')
  const content = await fs.readFile(workflowPath, 'utf-8')
  const parsed = yaml.parse(content)

  return parsed.on.workflow_dispatch.inputs.service.options
}

// MCP Tool Registration
export const ghReleaseDeployServiceMcpTool = {
  name: 'gh-release-deploy-service',
  description: 'Deploy a specific service in a release branch to a specified environment',
  inputSchema: {
    version: z.string().describe('Version to deploy (e.g., "1.2.5")'),
    env: z.string().describe('Environment to deploy to (e.g., "dev", "renana", "oriana")'),
    service: z.string().describe('Service to deploy (e.g., "client-be", "client-fe")'),
    skipTerraform: z.boolean().optional().describe('Skip terraform deployment step'),
  },
  outputSchema: {
    releaseBranch: z.string().describe('The release branch that was deployed'),
    version: z.string().describe('The version that was deployed'),
    environment: z.string().describe('The environment deployed to'),
    service: z.string().describe('The service that was deployed'),
    skipTerraformDeploy: z.boolean().describe('Whether terraform deployment was skipped'),
    success: z.boolean().describe('Whether the deployment was successful'),
  },
  handler: ghReleaseDeployService,
}
