import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'

import { SiteIndexError } from '../core/errors.js'
import { parseJson } from '../core/json.js'

export interface BucketObject {
  key: string
  body: string
  contentType: string
}

export const isNoSuchKey = (error: unknown): boolean => {
  return error instanceof Error && error.name === 'NoSuchKey'
}

export const listJsonKeys = async (s3: S3Client, bucket: string, prefix: string): Promise<string[]> => {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    )

    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith('.json')) keys.push(object.Key)
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)

  return keys.sort()
}

export const readJson = async (s3: S3Client, bucket: string, key: string): Promise<unknown> => {
  const source = `s3://${bucket}/${key}`
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = await object.Body?.transformToString('utf8')

  if (body === undefined) throw new SiteIndexError(`${source} has no body`)

  return parseJson(body, source)
}

export const putObject = async (s3: S3Client, bucket: string, object: BucketObject): Promise<void> => {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: object.body, ContentType: object.contentType }),
  )
}

export interface PutObjectsOutcome {
  writtenKeys: string[]
  /** `<key>: <reason>` per failed put; empty when every put succeeded. */
  failures: string[]
  cause?: unknown
}

/**
 * S3 has no multi-object transaction, so a failed put can leave the rest replaced. Every put is
 * awaited before returning, so the outcome names what is stale and no request outlives the invocation.
 */
export const putObjects = async (s3: S3Client, bucket: string, objects: BucketObject[]): Promise<PutObjectsOutcome> => {
  const results = await Promise.allSettled(
    objects.map((object) => {
      return putObject(s3, bucket, object)
    }),
  )

  const outcome: PutObjectsOutcome = { writtenKeys: [], failures: [] }

  for (const [index, result] of results.entries()) {
    const key = objects[index]?.key ?? ''

    if (result.status === 'fulfilled') {
      outcome.writtenKeys.push(key)
    } else {
      outcome.failures.push(`${key}: ${String(result.reason)}`)
      outcome.cause ??= result.reason
    }
  }

  return outcome
}
