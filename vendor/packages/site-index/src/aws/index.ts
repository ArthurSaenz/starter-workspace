import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import type { SiteIndexStats } from '../core/build.js'
import { buildSiteIndex, getShrinkRefusal } from '../core/build.js'
import { SiteIndexError, parseManifest } from '../core/manifest.js'
import type { SiteIndexConfig, SiteIndexFileName, SiteIndexManifest } from '../core/types.js'

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

const isNoSuchKey = (error: unknown): boolean => {
  return error instanceof Error && error.name === 'NoSuchKey'
}

const listManifestKeys = async (s3: S3Client, bucket: string): Promise<string[]> => {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: MANIFESTS_PREFIX, ContinuationToken: continuationToken }),
    )

    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith('.json')) keys.push(object.Key)
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)

  return keys.sort()
}

const readJson = async (s3: S3Client, bucket: string, key: string): Promise<unknown> => {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = await object.Body?.transformToString('utf8')

  if (body === undefined) throw new SiteIndexError(`s3://${bucket}/${key} has no body`)

  return JSON.parse(body)
}

const readPreviousUrlCount = async (s3: S3Client, bucket: string): Promise<number | undefined> => {
  try {
    const state = (await readJson(s3, bucket, STATE_KEY)) as Partial<SiteIndexRunState>

    return typeof state.urlCount === 'number' ? state.urlCount : undefined
  } catch (error) {
    if (isNoSuchKey(error)) return undefined

    throw error
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
    const keys = await listManifestKeys(s3, bucket)

    if (keys.length === 0) throw new SiteIndexError(`No manifests under s3://${bucket}/${MANIFESTS_PREFIX}`)

    const manifests: SiteIndexManifest[] = await Promise.all(
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

    await Promise.all(
      (Object.keys(files) as SiteIndexFileName[]).map((name) => {
        return s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `${PUBLIC_PREFIX}${name}`,
            Body: files[name],
            ContentType: CONTENT_TYPES[name],
          }),
        )
      }),
    )

    const state: SiteIndexRunState = { ...stats, generatedAt: new Date().toISOString() }

    // Written after the public files so a failed publish never advances the shrink baseline.
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: STATE_KEY,
        Body: JSON.stringify(state, null, 2),
        ContentType: 'application/json',
      }),
    )

    const result: SiteIndexRunResult = { ...state }

    if (distributionId) {
      const paths = (Object.keys(files) as SiteIndexFileName[]).map((name) => {
        return `/${name}`
      })
      const invalidation = await cloudFront.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: state.generatedAt,
            Paths: { Items: paths, Quantity: paths.length },
          },
        }),
      )

      if (invalidation.Invalidation?.Id) result.invalidationId = invalidation.Invalidation.Id
    }

    return result
  }
}
