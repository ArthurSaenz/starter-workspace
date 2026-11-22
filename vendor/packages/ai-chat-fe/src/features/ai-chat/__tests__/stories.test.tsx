/// <reference types="vite/client" />
import { composeStories } from '@storybook/react'
import type { Meta, StoryObj } from '@storybook/react'
import { describe, expect, it } from 'vitest'

import * as containerStories from '../__stories__/suggestions/suggestions.static.stories.js'

type StoriesModule = { default: Meta } & Record<string, StoryObj>

interface CatalogueParameters {
  fakeSupplies?: readonly string[]
  deniedRoute?: string
}

// The disclosure the plan's P4 hangs on: a story that declares what the fake supplies, or the route
// the Lambda denies, must SHOW it on the canvas (the kit's banner decorator). The plays assert their
// feature, not the banner, so this is the one place a dropped decorator turns red.
const bannerSelector = (story: StoryObj): string | null => {
  const catalogue = (story.parameters?.catalogue ?? {}) as CatalogueParameters

  if (catalogue.fakeSupplies?.length) return '[data-testid="catalogue-fake-only"]'
  if (catalogue.deniedRoute) return '[data-testid="catalogue-denied-route"]'

  return null
}

// Every feature's story files, so a story added anywhere in the package runs here unregistered.
const modules = import.meta.glob<StoriesModule>('../../*/__stories__/**/*.stories.tsx', { eager: true })

const { Default } = composeStories(containerStories)

// Before any play: a runner that composes without React's `renderToCanvas` fails every story with
// nothing on the canvas, and this line tells that apart from a play that failed on a real regression.
it('mounts a story through the React renderer', async () => {
  await Default.run()
  expect(document.querySelector('[data-testid="copilot-chat"]')).not.toBeNull()
})

for (const module of Object.values(modules)) {
  describe(module.default.title ?? 'untitled', () => {
    // `run()` is the whole story lifecycle — loaders, mount, play — so a play-less story still
    // proves it mounts, and the runner's own cleanups unmount the previous one first. The play's
    // own `expect` calls are the assertions; `run()` only resolves once every one of them passed.
    for (const [name, story] of Object.entries(composeStories(module))) {
      it(name, async () => {
        await expect(story.run()).resolves.toBeUndefined()

        const banner = bannerSelector(story)

        if (banner) expect(document.querySelector(banner)).not.toBeNull()
      })
    }
  })
}
