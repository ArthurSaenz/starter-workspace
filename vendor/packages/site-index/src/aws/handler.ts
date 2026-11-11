import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { S3Client } from '@aws-sdk/client-s3'

import type { SiteIndexStats } from '../core/build.js'
import { buildSiteIndex, getShrinkRefusal } from '../core/build.js'
import { SiteIndexError } from '../core/errors.js'
import { parseManifest } from '../core/manifest.js'
import type { SiteIndexConfig, SiteIndexFileName, SiteIndexFiles } from '../core/types.js'
import { isNoSuchKey, listJsonKeys, putObject, putObjects, readJson } from './s3.js'

export const MANIFESTS_PREFIX = 'manifests/'
export const PUBLIC_PREFIX = 'public/'
export const STATE_KEY = 'state/last-run.json'

const CONTENT_TYPES: Record<SiteIndexFileName, string> = {
  'sitemap.xml': 'application/xml; charset=utf-8',
  'robots.txt': 'text/plain; charset=utf-8',
  'llms.txt': 'text/plain; charset=utf-8',
}

export interface SiteIndexHandlerOptions {
  config: SiteIndexConfig
  bucket: string
  crawlable: boolean
  /** CloudFront distribution serving `public/`; omitted on envs without one. */
  distributionId?: string
  maxDropRatio?: number
  s3?: S3Client
  cloudFront?: CloudFrontClient
  warn?: (message: string, details?: unknown) => void
}

export interface SiteIndexEvent {
  /** Publishes even when the URL count fell past `maxDropRatio`. */
  force?: boolean
}

export interface SiteIndexRunState extends SiteIndexStats {
  generatedAt: string
}

export interface SiteIndexRunResult extends SiteIndexRunState {
  invalidationId?: string
}

const readPreviousUrlCount = async (s3: S3Client, bucket: string): Promise<number | undefined> => {
  try {
    const state = (await readJson(s3, bucket, STATE_KEY)) as Partial<SiteIndexRunState> | null

    return typeof state?.urlCount === 'number' ? state.urlCount : undefined
  } catch (error) {
    if (isNoSuchKey(error)) return undefined

    throw error
  }
}

const getFileNames = (files: SiteIndexFiles) => {
  return Object.keys(files) as SiteIndexFileName[]
}

const invalidate = async (
  cloudFront: CloudFrontClient,
  distributionId: string,
  files: SiteIndexFiles,
  callerReference: string,
): Promise<string | undefined> => {
  const paths = getFileNames(files).map((name) => {
    return `/${name}`
  })

  try {
    const invalidation = await cloudFront.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: { CallerReference: callerReference, Paths: { Items: paths, Quantity: paths.length } },
      }),
    )

    return invalidation.Invalidation?.Id
  } catch (error) {
    throw new SiteIndexError(
      `Published, but the CloudFront invalidation of ${distributionId} failed; re-run to retry`,
      [String(error)],
      { cause: error },
    )
  }
}

/**
 * The aggregator Lambda: every manifest under `manifests/` → sitemap.xml, robots.txt and llms.txt
 * under `public/`. It is the only writer of `public/`; any invalid manifest or a shrink past the
 * guard fails the run before a single file is replaced.
 */
export const createSiteIndexHandler = (options: SiteIndexHandlerOptions) => {
  const { config, bucket, crawlable, distributionId, maxDropRatio } = options
  const s3 = options.s3 ?? new S3Client({})
  const cloudFront = options.cloudFront ?? new CloudFrontClient({})
  const warn = options.warn ?? console.warn

  return async (event?: SiteIndexEvent): Promise<SiteIndexRunResult> => {
    const keys = await listJsonKeys(s3, bucket, MANIFESTS_PREFIX)

    if (keys.length === 0) throw new SiteIndexError(`No manifests under s3://${bucket}/${MANIFESTS_PREFIX}`)

    const manifests = await Promise.all(
      keys.map(async (key) => {
        return parseManifest(await readJson(s3, bucket, key), `s3://${bucket}/${key}`)
      }),
    )

    const { files, stats } = buildSiteIndex(config, manifests, { crawlable })

    const refusal = event?.force
      ? null
      : getShrinkRefusal(await readPreviousUrlCount(s3, bucket), stats.urlCount, maxDropRatio)

    if (refusal) throw new SiteIndexError(refusal)
    if (stats.duplicates.length > 0) warn('site-index: duplicate paths dropped', stats.duplicates)

    await putObjects(
      s3,
      bucket,
      getFileNames(files).map((name) => {
        return { key: `${PUBLIC_PREFIX}${name}`, body: files[name], contentType: CONTENT_TYPES[name] }
      }),
    )

    const state: SiteIndexRunState = { ...stats, generatedAt: new Date().toISOString() }

    // Written after the public files so a failed publish never advances the shrink baseline.
    await putObject(s3, bucket, {
      key: STATE_KEY,
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    })

    const result: SiteIndexRunResult = { ...state }

    if (distributionId) {
      const invalidationId = await invalidate(cloudFront, distributionId, files, state.generatedAt)

      if (invalidationId) result.invalidationId = invalidationId
    }

    return result
  }
}
