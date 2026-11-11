import type { CloudFrontClient } from '@aws-sdk/client-cloudfront'
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import type { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'

import { config, manifest } from '../../core/__tests__/fixtures.js'
import { SiteIndexError } from '../../core/errors.js'
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
const createFakeBucket = (
  initial: Record<string, unknown>,
  pageSize = 1000,
  failures: { putKeys?: string[]; invalidation?: Error } = {},
): FakeBucket => {
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
      if (failures.putKeys?.includes(command.input.Key ?? '')) throw new Error('SlowDown')

      objects.set(command.input.Key ?? '', String(command.input.Body))

      return {}
    }

    throw new Error(`unexpected S3 command ${String(command)}`)
  })

  const cloudFrontSend = vi.fn(async (command: unknown) => {
    if (!(command instanceof CreateInvalidationCommand)) throw new TypeError('unexpected CloudFront command')

    if (failures.invalidation) throw failures.invalidation

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

  it('names the object when a manifest is not JSON, and writes nothing', async () => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', [{ path: '/' }]),
      'manifests/seo.json': '{"producer": "seo", "urls": [',
      'public/sitemap.xml': 'old',
    })

    const error = await createHandler(bucket)().catch((caught: unknown) => {
      return caught
    })

    expect(error).toBeInstanceOf(SiteIndexError)
    expect((error as Error).message).toContain('s3://hulyo-site-index-test/manifests/seo.json is not valid JSON')
    expect(bucket.objects.get('public/sitemap.xml')).toBe('old')
  })

  it('names the object when one has no body', async () => {
    const bucket = createFakeBucket({ 'manifests/client.json': manifest('client', [{ path: '/' }]) })
    const send = bucket.s3.send as unknown as Mock<(command: unknown) => Promise<unknown>>
    const original = send.getMockImplementation()

    send.mockImplementation(async (command: unknown) => {
      return command instanceof GetObjectCommand ? {} : original?.(command)
    })

    await expect(createHandler(bucket)()).rejects.toThrow(
      's3://hulyo-site-index-test/manifests/client.json has no body',
    )
  })

  it('names the state object when the shrink baseline is unreadable, and still publishes with force', async () => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', [{ path: '/' }]),
      [STATE_KEY]: '{"urlCount": 1',
      'public/sitemap.xml': 'old',
    })

    const handler = createHandler(bucket)

    await expect(handler()).rejects.toThrow(`s3://hulyo-site-index-test/${STATE_KEY} is not valid JSON`)
    expect(bucket.objects.get('public/sitemap.xml')).toBe('old')
    await expect(handler({ force: true })).resolves.toMatchObject({ urlCount: 1 })
  })

  it.each(['null', '{"urlCount": "114"}'])('takes state %s as no baseline', async (state) => {
    const bucket = createFakeBucket({
      'manifests/client.json': manifest('client', [{ path: '/' }]),
      [STATE_KEY]: state,
    })

    await expect(createHandler(bucket)()).resolves.toMatchObject({ urlCount: 1 })
  })

  it('rethrows a state read failure other than a missing key', async () => {
    const bucket = createFakeBucket({ 'manifests/client.json': manifest('client', [{ path: '/' }]) })
    const send = bucket.s3.send as unknown as Mock<(command: unknown) => Promise<unknown>>
    const original = send.getMockImplementation()
    const denied = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })

    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetObjectCommand && command.input.Key === STATE_KEY) throw denied

      return original?.(command)
    })

    await expect(createHandler(bucket)()).rejects.toBe(denied)
    expect(bucket.objects.has('public/sitemap.xml')).toBe(false)
  })

  it('waits for every put, names the file that failed and keeps the shrink baseline', async () => {
    const bucket = createFakeBucket(
      {
        'manifests/client.json': manifest('client', [{ path: '/' }]),
        [STATE_KEY]: { urlCount: 1, generatedAt: 'before' },
        'public/robots.txt': 'old',
      },
      1000,
      { putKeys: ['public/robots.txt'] },
    )

    const error = await createHandler(bucket)().catch((caught: unknown) => {
      return caught
    })

    expect(error).toBeInstanceOf(SiteIndexError)
    expect((error as SiteIndexError).message).toContain('Wrote 2 of 3 objects')
    expect((error as SiteIndexError).issues).toEqual(['public/robots.txt: Error: SlowDown'])
    expect(bucket.objects.get('public/sitemap.xml')).toContain('<urlset')
    expect(bucket.objects.get('public/llms.txt')).toContain('# Hulyo')
    expect(JSON.parse(bucket.objects.get(STATE_KEY) ?? '{}')).toMatchObject({ generatedAt: 'before' })
  })

  it('says the files are live when only the invalidation failed', async () => {
    const throttled = new Error('TooManyInvalidationsInProgress')

    const bucket = createFakeBucket({ 'manifests/client.json': manifest('client', [{ path: '/' }]) }, 1000, {
      invalidation: throttled,
    })

    const error = await createHandler(bucket, { distributionId: 'E1' })().catch((caught: unknown) => {
      return caught
    })

    expect(error).toBeInstanceOf(SiteIndexError)
    expect((error as Error).message).toContain('Published, but the CloudFront invalidation of E1 failed')
    expect((error as Error).cause).toBe(throttled)
    expect(bucket.objects.has(STATE_KEY)).toBe(true)
  })
})
