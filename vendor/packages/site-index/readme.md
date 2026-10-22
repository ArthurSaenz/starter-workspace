# @wl/site-index

One index of a site's public URLs, rendered into `sitemap.xml`, `robots.txt` and `llms.txt`
([llmstxt.org](https://llmstxt.org)). Every app that owns public pages ships a manifest; one
aggregator Lambda merges them and is the only writer of the three files.

```
producer deploy ──PUT──▶ s3://<brand>-site-index-<env>/manifests/<producer>.json
                └─invoke─▶ aggregator ──▶ public/{sitemap.xml,robots.txt,llms.txt} + state/last-run.json
CloudFront (origin_path /public) ──▶ /sitemap.xml /robots.txt /llms.txt
```

## Entry points

| Import                  | Runtime                 | What                                                                                                         |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@wl/site-index`        | any, no deps            | `defineSiteIndexConfig`, `createManifest`, `parseManifest`, `buildSiteIndex`, the three renderers.           |
| `@wl/site-index/node`   | Node build step         | `writeManifest(dir, manifest)`, `readManifests(dir)`, `writeSiteIndexFiles(dir, files)` for a local preview. |
| `@wl/site-index/deploy` | infra-kit deploy script | `publishSiteIndexManifest(toolkit, options)`: upload a manifest, invoke the aggregator. Served from `src/`.  |
| `@wl/site-index/aws`    | Lambda                  | `createSiteIndexHandler(options)`; needs `@aws-sdk/client-s3` and `@aws-sdk/client-cloudfront`.              |

## Manifest contract

```json
{
  "producer": "seo",
  "version": 1,
  "generatedAt": "2026-10-22T09:11:00.000Z",
  "urls": [{ "path": "/shows/tel-aviv/standup", "group": "shows", "title": "…", "description": "…" }]
}
```

- `path` is site-relative; the host comes from `config.origin`. A trailing slash is significant.
- `group` picks the llms.txt section (or leave it out and let `config.llms.groupPrefixes` assign one by path prefix); `llms: false` keeps a URL in the sitemap only.
- Validation is strict: an unknown field, a wrong type or a bad path fails with the source, the entry
  index, its path and the expected value. `createManifest` runs it at build time, the aggregator on
  every S3 object.
- Producers merge in name order; on a repeated path the first producer wins and the drop is reported.

## Aggregator guarantees

The run fails before replacing any file when a manifest is invalid, the prefix is empty, a URL sits
under `config.disallow`, two manifests share a producer, or the URL count fell more than
`maxDropRatio` (default 30%) below the last published run. Invoke with `{ "force": true }` to publish
an intended drop.

## Wiring

```ts
// producer build step
import { createManifest } from '@wl/site-index'
// the producer's deploy.ts, in postDeploy
import { publishSiteIndexManifest } from '@wl/site-index/deploy'
import { writeManifest } from '@wl/site-index/node'

await writeManifest('out/site-index', createManifest('client', urls))

await publishSiteIndexManifest(toolkit, {
  manifestPath: join(appDir, 'out/site-index/client.json'),
  bucketParameter: '/<brand>/s3/site-index/bucket_name',
  aggregatorFunctionName: `<service>-${stage}-siteIndexAggregate`,
})
```

```ts
// aggregator Lambda
import { createSiteIndexHandler } from '@wl/site-index/aws'

export const handler = createSiteIndexHandler({
  config: siteIndexConfig,
  bucket: process.env['SITE_INDEX_BUCKET']!,
  crawlable: process.env['ROBOTS_FILE'] !== 'disallow',
  // An empty id skips the CloudFront invalidation (envs without a distribution).
  distributionId: process.env['CLOUD_FRONT_WEBSITE_ID'] ?? '',
})
```
