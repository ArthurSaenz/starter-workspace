import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCatalogueComponent } from '../components/feature-catalogue-component.js'
import { AREAS, FEATURES, countByStatus, renderCatalogueMarkdown } from '../services/main.js'

const counts = countByStatus(FEATURES)

const meta: Meta<typeof FeatureCatalogueComponent> = {
  // A literal, not `CATALOGUE_STORY_TITLE`: the CSF indexer reads titles statically and crashes on an
  // imported constant ("Cannot read properties of null (reading 'loc')"); features.test.ts pins the two.
  title: 'features/catalogue/Catalogue',
  component: FeatureCatalogueComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          `${FEATURES.length} features in ${AREAS.length} areas: ${Object.entries(counts)
            .map(([status, count]) => {
              return `${count} ${status}`
            })
            .join(', ')}.`,
          'The same registry renders the README block below (`pnpm --filter @wl/ai-chat-fe catalogue`).',
          '',
          renderCatalogueMarkdown(FEATURES),
        ].join('\n'),
      },
    },
  },
  args: { features: FEATURES, areas: AREAS },
}

export default meta
type Story = StoryObj<typeof FeatureCatalogueComponent>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Every feature in the registry, grouped by area, with its status, blockers, seam and stories.',
      },
    },
  },
}
