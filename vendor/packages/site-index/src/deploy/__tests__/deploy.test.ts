import { describe, expect, it, vi } from 'vitest'

import type { SiteIndexDeployToolkit } from '../index.js'
import { publishSiteIndexManifest } from '../index.js'

const OPTIONS = {
  manifestPath: '/repo/out/apps/client/ui/out/site-index/client.json',
  bucketParameter: '/hulyo/s3/site-index/bucket_name',
  aggregatorFunctionName: 'prerender-api-v1-dev-siteIndexAggregate',
}

const createToolkit = (overrides: Partial<SiteIndexDeployToolkit> = {}) => {
  return {
    ssm: vi.fn(async () => {
      return { [OPTIONS.bucketParameter]: 'site-index-bucket-hulyo-dev' }
    }),
    aws: vi.fn(async () => {}),
    invokeLambdas: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('publishSiteIndexManifest', () => {
  it('uploads under manifests/ by file name, then runs the aggregator as a blocking step', async () => {
    const toolkit = createToolkit()

    await publishSiteIndexManifest(toolkit, OPTIONS)

    expect(toolkit.aws).toHaveBeenCalledWith([
      's3',
      'cp',
      OPTIONS.manifestPath,
      's3://site-index-bucket-hulyo-dev/manifests/client.json',
      '--content-type',
      'application/json',
      '--only-show-errors',
    ])
    expect(toolkit.invokeLambdas).toHaveBeenCalledWith({
      region: 'eu-west-1',
      blocking: [{ functionName: OPTIONS.aggregatorFunctionName }],
    })
  })

  it('fails the deploy on a missing bucket parameter unless best-effort', async () => {
    const missing = new Error('ParameterNotFound')

    const ssm = vi.fn(async () => {
      throw missing
    })

    await expect(publishSiteIndexManifest(createToolkit({ ssm }), OPTIONS)).rejects.toBe(missing)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const toolkit = createToolkit({ ssm })

    await expect(publishSiteIndexManifest(toolkit, { ...OPTIONS, isBestEffort: true })).resolves.toBeUndefined()
    expect(toolkit.aws).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('invokes as a warning-only step when best-effort', async () => {
    const toolkit = createToolkit()

    await publishSiteIndexManifest(toolkit, { ...OPTIONS, isBestEffort: true })

    expect(toolkit.invokeLambdas).toHaveBeenCalledWith({
      region: 'eu-west-1',
      steps: [[{ functionName: OPTIONS.aggregatorFunctionName }]],
    })
  })
})
