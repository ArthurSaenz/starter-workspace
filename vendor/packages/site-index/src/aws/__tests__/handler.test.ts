import type { CloudFrontClient } from '@aws-sdk/client-cloudfront'
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import type { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import { config, manifest } from '../../core/__tests__/fixtures.js'
import { STATE_KEY, createSiteIndexHandler } from '../index.js'

const BUCKET = 'hulyo-site-index-test'

interface FakeBucket {
  objects: Map<string, string>
  s3: S3Client
  cloudFront: CloudFrontClient
  invalidations: string[][]
}

const noSuchKey = () => {
  return Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
}

// One page per list call when `pageSize` is set, so pagination is exercised.
const createFakeBucket = (initial: Record<string, unknown>, pageSize = 1000): FakeBucket => {
  const objects = new Map(
    Object.entries(initial).map(([key, value]) => {
      return [key, typeof value === 'string' ? value : JSON.stringify(value)]
    }),
  )

  const invalidations: string[][] = []

  const s3Send = vi.fn(async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      const { Prefix = '', ContinuationToken } = command.input

      const keys = [...objects.keys()].filter((key) => {
        return key.startsWith(Prefix)
      })

      const start = ContinuationToken ? Number(ContinuationToken) : 0
      const page = keys.slice(start, start + pageSize)
      const next = start + pageSize

      return {
        Contents: page.map((Key) => {
          return { Key }
        }),
        IsTruncated: next < keys.length,
        NextContinuationToken: String(next),
      }
    }

    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key ?? '')

      if (body === undefined) throw noSuchKey()

      return {
        Body: {
          transformToString: async () => {
            return body
          },
        },
      }
    }

    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key ?? '', String(command.input.Body))

      return {}
    }

    throw new Error(`unexpected S3 command ${String(command)}`)
  })

  const cloudFrontSend = vi.fn(async (command: unknown) => {
    if (!(command instanceof CreateInvalidationCommand)) throw new TypeError('unexpected CloudFront command')

    invalidations.push(command.input.InvalidationBatch?.Paths?.Items ?? [])

    return { Invalidation: { Id: 'I123' } }
  })

  return {
    objects,
    invalidations,
    s3: { send: s3Send } as unknown as S3Client,
    cloudFront: { send: cloudFrontSend } as unknown as CloudFrontClient,
  }
}

const createHandler = (bucket: FakeBucket, overrides: { distributionId?: string } = {}) => {
  return createSiteIndexHandler({
    config,
    bucket: BUCKET,
    crawlable: true,
    s3: bucket.s3,
    cloudFront: bucket.cloudFront,
    warn: vi.fn(),
    ...overrides,
  })
}

const manyPaths = (count: number, prefix: string) => {
  return Array.from({ length: count }, (_, index) => {
    return { path: `/${prefix}/${index}` }
  })
}

describe('createSiteIndexHandler', () => {
  it('publishes every manifest under manifests/ across list pages, then the state, then invalidates', async () => {
    const bucket = createFakeBucket(
      {
        'manifests/client.json': manifest('client', [{ path: '/' }]),
        'manifests/seo.json': manifest('seo', [{ path: '/shows/eilat', group: 'shows' }]),
        'manifests/special.json': manifest('special', [{ path: '/special/christmas-markets/' }]),
        'manifests/readme.txt': 'not a manifest',
        'public/sitemap.xml': 'old',
      },
      2,
    )

    const result = await createHandler(bucket, { distributionId: 'E1' })()

    expect(result).toMatchObject({
      urlCount: 3,
      producers: { client: 1, seo: 1, special: 1 },
      invalidationId: 'I123',
    })
    expect(bucket.objects.get('public/sitemap.xml')).toContain('https://www.hulyo.co.il/special/christmas-markets/')
    expect(bucket.objects.get('public/llms.txt')).toContain('## Shows')
    expect(bucket.objects.get('public/robots.txt')).toContain('Sitemap: https://www.hulyo.co.il/sitemap.xml')
    expect(JSON.parse(bucket.objects.get(STATE_KEY) ?? '{}')).toMatchObject({ urlCount: 3 })
    expect(bucket.invalidations).toEqual([['/sitemap.xml', '/robots.txt', '/llms.txt']])
  })

  it('skips the invalidation without a distribution', async () => {
    const bucket = createFakeBucket({ 'manifests/client.json': manifest('client', [{ path: '/' }]) })

    const result = await createHandler(bucket)()

    expect(result.invalidationId).toBeUndefined()
    expect(bucket.invalidations).toEqual([])
  })

  it('fails without writing anything when one manifest is invalid', async () => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', [{ path: '/' }]),
      'manifests/seo.json': { producer: 'seo', version: 1, generatedAt: 'x', urls: [{ path: 'no-slash' }] },
      'public/sitemap.xml': 'old',
    })

    await expect(createHandler(bucket)()).rejects.toThrow('s3://hulyo-site-index-test/manifests/seo.json')
    expect(bucket.objects.get('public/sitemap.xml')).toBe('old')
    expect(bucket.objects.has(STATE_KEY)).toBe(false)
  })

  it('fails on an empty manifests prefix', async () => {
    await expect(createHandler(createFakeBucket({}))()).rejects.toThrow(/No manifests/)
  })

  it('refuses a shrink past the guard, publishes it with force', async () => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', manyPaths(5, 'c')),
      [STATE_KEY]: { urlCount: 114 },
      'public/sitemap.xml': 'old',
    })

    const handler = createHandler(bucket)

    await expect(handler()).rejects.toThrow(/fell from 114 to 5/)
    expect(bucket.objects.get('public/sitemap.xml')).toBe('old')

    await expect(handler({ force: true })).resolves.toMatchObject({ urlCount: 5 })
    expect(JSON.parse(bucket.objects.get(STATE_KEY) ?? '{}')).toMatchObject({ urlCount: 5 })
  })

  it('reports dropped duplicates through warn', async () => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', [{ path: '/' }]),
      'manifests/seo.json': manifest('seo', [{ path: '/' }]),
    })

    const warn = vi.fn()

    await createSiteIndexHandler({ config, bucket: BUCKET, crawlable: true, s3: bucket.s3, warn })()

    expect(warn).toHaveBeenCalledWith('site-index: duplicate paths dropped', [
      { path: '/', keptFrom: 'client', droppedFrom: 'seo' },
    ])
  })
})
