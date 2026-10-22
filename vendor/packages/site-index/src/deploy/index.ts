// Loaded by `infra-kit deploy-run` straight from source (the package.json export points here), before any build has
// produced dist/: keep this file free of relative imports and of non-erasable TypeScript so Node can strip it.
import { basename } from 'node:path'

/** The slice of infra-kit's DeployToolkit this needs; a deploy script passes its own toolkit. */
export interface SiteIndexDeployToolkit {
  ssm: (names: string[]) => Promise<Record<string, string>>
  aws: (args: string[]) => Promise<void>
  invokeLambdas: (options: {
    region?: string
    blocking?: { functionName: string }[]
    steps?: { functionName: string }[][]
  }) => Promise<void>
}

export interface PublishSiteIndexManifestOptions {
  /** The producer's manifest, `<app>/out/site-index/<producer>.json`. */
  manifestPath: string
  /** SSM parameter holding the brand's site-index bucket name. */
  bucketParameter: string
  /** Physical name of the aggregator Lambda, e.g. `prerender-api-v1-prod-siteIndexAggregate`. */
  aggregatorFunctionName: string
  region?: string
  /**
   * `true` while the legacy sitemap pipeline still serves production: a missing bucket or an aggregator
   * refusal only warns. Drop it once CloudFront serves the site-index files, so a broken publish fails the deploy.
   */
  isBestEffort?: boolean
}

const DEFAULT_REGION = 'eu-west-1'

/** Uploads one producer's manifest to `manifests/` and re-runs the aggregator. */
export const publishSiteIndexManifest = async (
  toolkit: SiteIndexDeployToolkit,
  options: PublishSiteIndexManifestOptions,
): Promise<void> => {
  const { manifestPath, bucketParameter, aggregatorFunctionName, region = DEFAULT_REGION, isBestEffort } = options

  try {
    const bucket = (await toolkit.ssm([bucketParameter]))[bucketParameter]

    await toolkit.aws([
      's3',
      'cp',
      manifestPath,
      `s3://${bucket}/manifests/${basename(manifestPath)}`,
      '--content-type',
      'application/json',
      '--only-show-errors',
    ])
    const invocation = { functionName: aggregatorFunctionName }

    // `steps` only warn on a failed invocation; `blocking` fails the deploy on the aggregator's refusal.
    await toolkit.invokeLambdas(isBestEffort ? { region, steps: [[invocation]] } : { region, blocking: [invocation] })
  } catch (error) {
    if (!isBestEffort) throw error

    console.warn(`Warning: site-index publish of ${manifestPath} failed, but continuing...`, error)
  }
}
