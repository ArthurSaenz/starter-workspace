import { useFrontendTool, useHumanInTheLoop } from '@copilotkit/react-core/v2'

import { HITL_TOOL_CALL, TOOL_CALL } from './scenarios.js'

// Rows 23/24 are tool PATHS, not product features: the client registers no frontend tool today.
// These wrappers are what a product tool would look like; they mount through the container's
// `children` seam so the hooks sit inside the provider the product actually renders.
// `parameters` is a StandardSchemaV1 (zod), which this package does not depend on; core JSON-parses
// the args regardless, so the demos go schema-less.

// `extends Record<string, unknown>`: the hook's generic constraint needs an index signature.
interface HotelCardArgs extends Record<string, unknown> {
  name: string
  nights: number
}

export const ShowHotelCard = () => {
  useFrontendTool<HotelCardArgs>({
    name: TOOL_CALL.name,
    description: 'Show a hotel card for a stay',
    handler: async () => {
      return TOOL_CALL.result
    },
    render: (props) => {
      const { args, status } = props

      return (
        <div data-testid="hotel-card" style={{ border: '1px solid currentColor', borderRadius: 8, padding: 12 }}>
          <strong>{args.name}</strong> · {args.nights} nights · {status}
        </div>
      )
    },
  })

  return null
}

interface ConfirmBudgetArgs extends Record<string, unknown> {
  budgetUsd: number
}

// `render` is a ComponentType of a status-discriminated union, which does not contextually type a
// destructured arrow; the widened shape below is assignable from every member.
interface ConfirmBudgetRenderProps {
  args: Partial<ConfirmBudgetArgs>
  respond?: (result: unknown) => void
  status: string
}

export const ConfirmBudget = () => {
  useHumanInTheLoop<ConfirmBudgetArgs>({
    name: HITL_TOOL_CALL.name,
    description: 'Ask the traveller to confirm the budget',
    render: (props: ConfirmBudgetRenderProps) => {
      const { args, respond, status } = props

      return (
        <div data-testid="hitl-prompt" style={{ border: '1px solid currentColor', borderRadius: 8, padding: 12 }}>
          Keep it under ${args.budgetUsd}? ({status}){' '}
          <button
            type="button"
            onClick={() => {
              respond?.('yes')
            }}
          >
            Yes
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              respond?.('no')
            }}
          >
            No
          </button>
        </div>
      )
    },
  })

  return null
}
