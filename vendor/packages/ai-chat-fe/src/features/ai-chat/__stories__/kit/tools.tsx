import type { ReactFrontendTool } from '@copilotkit/react-core/v2'

import { TOOL_CALL } from '../../__tests__/helpers/index.js'

interface HotelCardProps {
  args: Record<string, unknown>
  status: string
}

const HotelCard = (props: HotelCardProps) => {
  const { args, status } = props

  return (
    <div data-testid="hotel-card" data-status={status} style={{ border: '1px solid currentColor', padding: 12 }}>
      {String(args.name)} · {String(args.nights)} nights · {status}
    </div>
  )
}

type ToolParameters = NonNullable<ReactFrontendTool['parameters']>

// A Standard JSON Schema V1 object by hand: CopilotKitProvider registers a `frontendTools[].render`
// ONLY when the tool carries `parameters` (a schema-less render is dropped silently — the hook
// path renders without one), and this package ships no schema library.
const hotelCardParameters = {
  '~standard': {
    version: 1 as const,
    vendor: 'ai-chat-story',
    validate: (value: unknown) => {
      return { value }
    },
    jsonSchema: {
      input: () => {
        return { type: 'object', properties: { name: { type: 'string' }, nights: { type: 'number' } } }
      },
      output: () => {
        return { type: 'object', properties: { name: { type: 'string' }, nights: { type: 'number' } } }
      },
    },
  },
} as ToolParameters

/** `showHotelCard` declared on `provider.frontendTools`, with the schema its `render` needs. */
export const showHotelCardTool: ReactFrontendTool = {
  name: TOOL_CALL.name,
  description: 'Show a hotel card for a stay',
  parameters: hotelCardParameters,
  handler: async () => {
    return TOOL_CALL.result
  },
  render: HotelCard,
}
