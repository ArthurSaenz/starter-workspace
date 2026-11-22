import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { FeatureCatalogueComponent } from '../components/feature-catalogue-component.js'
import type { Area, Feature } from '../types.js'

const areas: readonly Area[] = [
  { id: 'surfaces', title: 'Surfaces and copy' },
  { id: 'threads', title: 'Threads' },
  { id: 'composer', title: 'Composer' },
]

const features: readonly Feature[] = [
  {
    id: 'surface.inline',
    area: 'surfaces',
    title: 'Inline chat',
    summary: 'Full-height chat',
    status: 'on',
    seam: { kind: 'top', prop: 'surface' },
    stories: ['Default', 'BoundedHeight'],
    docs: '',
  },
  {
    id: 'threads.list',
    area: 'threads',
    title: 'Thread list',
    summary: 'List conversations',
    status: 'backend-blocked',
    blockedBy: ['lambda-route', 'lambda-backend'],
    seam: { kind: 'children', hook: 'useThreads' },
    stories: ['ListIsDenied'],
    docs: '',
  },
  {
    id: 'misc.telemetry',
    area: 'threads',
    title: 'OSS telemetry',
    summary: 'Runtime-side',
    status: 'not-applicable',
    seam: { kind: 'none' },
    stories: [],
    docs: '',
  },
]

describe('featureCatalogueComponent', () => {
  it('renders one row per feature, grouped under the areas that have one', async () => {
    const screen = await render(<FeatureCatalogueComponent features={features} areas={areas} />)

    await expect.element(screen.getByTestId('catalogue')).toBeVisible()
    expect(screen.getByTestId('catalogue-feature').elements()).toHaveLength(features.length)
    // Composer has no feature, so it gets no section.
    expect(screen.getByTestId('catalogue-area').elements()).toHaveLength(2)
  })

  it('shows the blockers next to the status and a dash for a feature without stories', async () => {
    const screen = await render(<FeatureCatalogueComponent features={features} areas={areas} />)
    const blocked = screen.getByTestId('catalogue-feature').filter({ hasText: 'Thread list' })
    const noStories = screen.getByTestId('catalogue-feature').filter({ hasText: 'OSS telemetry' })

    await expect.element(blocked).toMatchTextContent(/backend-blocked \(lambda-route, lambda-backend\)/)
    await expect.element(blocked).toMatchTextContent(/children \(useThreads\)/)
    await expect.element(blocked).toMatchTextContent(/ListIsDenied/)
    await expect.element(noStories).toMatchTextContent(/—$/)
  })

  it('appends a consumer className', async () => {
    const screen = await render(<FeatureCatalogueComponent features={features} areas={areas} className="mt-2" />)

    await expect.element(screen.getByTestId('catalogue')).toHaveAttribute('class', 'space-y-8 text-sm mt-2')
  })
})
