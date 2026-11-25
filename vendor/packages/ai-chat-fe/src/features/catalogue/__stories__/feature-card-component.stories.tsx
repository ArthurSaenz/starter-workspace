import type { Meta, StoryObj } from '@storybook/react'

import { FeatureCardComponent } from '../components/feature-card-component.js'
import { FEATURES } from '../services/main.js'

const featureById = (id: string) => {
  const feature = FEATURES.find((candidate) => {
    return candidate.id === id
  })

  if (!feature) throw new Error(`No catalogue feature ${id}`)

  return feature
}

// Same title as the table's file on purpose: Storybook merges CSF files that share a title into one
// component entry (and one autodocs page), and the lint rule wants one stories file per component.
const meta: Meta<typeof FeatureCardComponent> = {
  // A literal, not `CATALOGUE_STORY_TITLE`: the CSF indexer reads titles statically and crashes on an
  // imported constant ("Cannot read properties of null (reading 'loc')"); features.test.ts pins the two.
  title: 'features/catalogue/Catalogue',
  component: FeatureCardComponent,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof FeatureCardComponent>

export const Card: Story = {
  args: { feature: featureById('copy.labels') },
  parameters: {
    docs: {
      description: {
        story:
          'A usable feature: its status badge, where to turn it on (here `chat.labels`) and its notes. No blockers.',
      },
    },
  },
}

export const BackendBlockedCard: Story = {
  args: { feature: featureById('threads.list') },
  parameters: {
    docs: {
      description: {
        story:
          'A feature the backend does not support yet: the status reads backend-blocked and the card names what blocks it.',
      },
    },
  },
}

export const FakeOnlyBanner: Story = {
  args: {
    feature: featureById('messages.reasoning'),
    fakeSupplies: ['THINKING_START', 'THINKING_TEXT_MESSAGE_CONTENT'],
  },
  parameters: {
    docs: {
      description: {
        story:
          'The banner a story shows when the Storybook runtime fake supplies events the real Lambda never sends — here the reasoning frames. Pass `fakeSupplies` to turn it on.',
      },
    },
  },
}
