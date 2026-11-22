import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { FeatureCardComponent } from '../../catalogue/index.js'
import { featureById } from '../__stories__/kit/define-feature-meta.js'
import { TALK_PAST_MESSAGE, TalkPastPrompt } from '../__stories__/kit/hitl.js'
import { StartRun } from '../__stories__/kit/start-run.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { ConfirmBudget } from './helpers/demo-tools.js'
import { HITL_REPLY, HITL_TOOL_CALL, NOMADREAM_PRESET, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime } from './helpers/index.js'

// The Human in the loop area: what its stories show, asserted. The wait-state look (no cursor, the
// arrow icon, nothing posted to /stop) and a typed Yes / Enter-during-wait are ai-chat-tools.test.tsx;
// interrupts are hitl-interrupt.test.tsx.

const CURSOR = 'copilot-loading-cursor'

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

type Screen = Awaited<ReturnType<typeof render>>

const expectPromptText = async (screen: Screen, testId: string, text: string) => {
  await vi.waitFor(() => {
    expect(screen.getByTestId(testId).element().textContent).toContain(text)
  })
}

describe('human in the loop', () => {
  let runtime: FakeRuntime | undefined

  afterEach(() => {
    runtime?.restore()
    runtime = undefined
  })

  describe('approval tool', () => {
    it('opens on the prompt waiting for an answer when the story starts the run', async () => {
      runtime = installRuntimeScenario(scenarios.humanInTheLoop)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ConfirmBudget />
          <StartRun message="budget?" />
        </AIChat>,
      )

      await expectPromptText(screen, 'hitl-prompt', 'Keep it under $4200? (executing)')
      await expect.element(screen.getByTestId(CURSOR)).not.toBeInTheDocument()
      expect(runtime.runs).toHaveLength(1)
    })

    it('talking past the prompt runs the agent without an answer and leaves the prompt open', async () => {
      runtime = installRuntimeScenario(scenarios.humanInTheLoop)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <ConfirmBudget />
          <StartRun message="budget?" />
          <TalkPastPrompt />
        </AIChat>,
      )

      await expect.element(screen.getByText(HITL_REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(2)

      const messages = runtime.runs[1]?.body.messages ?? []

      expect(messages).toContainEqual(expect.objectContaining({ role: 'user', content: TALK_PAST_MESSAGE }))
      expect(
        messages.some((message) => {
          return message.role === 'assistant' && message.toolCalls?.[0]?.function.name === HITL_TOOL_CALL.name
        }),
      ).toBe(true)
      expect(
        messages.some((message) => {
          return message.role === 'tool'
        }),
      ).toBe(false)

      await expectPromptText(screen, 'hitl-prompt', '(executing)')
      await expect.element(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
    })
  })

  describe('features we cannot use show only their card', () => {
    it.each([['hitl.governed', 'out-of-scope']] as const)('%s is %s', async (id, status) => {
      const screen = await render(<FeatureCardComponent feature={featureById(id)} />)

      await expect.element(screen.getByTestId('catalogue-feature-card')).toHaveAttribute('data-feature-id', id)
      await expect.element(screen.getByTestId('catalogue-status')).toHaveTextContent(status)

      expect(screen.getByTestId('catalogue-blocked-by').query()).toBeNull()
    })
  })
})
