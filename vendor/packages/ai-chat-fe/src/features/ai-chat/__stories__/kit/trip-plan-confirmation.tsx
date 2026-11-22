import { useAgent, useCopilotKit, useInterrupt } from '@copilotkit/react-core/v2'
import type { InterruptEvent } from '@copilotkit/react-core/v2'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { TRIP_PLAN_CONFIRM_REASON } from '../../__tests__/helpers/index.js'
import type { TripPlanConfirmation } from '../../__tests__/helpers/index.js'
import { useAwaitingInterrupt } from '../../services/main.js'

interface ConfirmationCardProps {
  id: string | undefined
  message: string | undefined
  confirmation: TripPlanConfirmation | undefined
  onAllow: () => void
  onKeep: () => void
}

/**
 * What the agent wants to take out of the trip plan, from the interrupt's `metadata`, with the two
 * answers. `message` is the backend's one-sentence fallback for a payload this card cannot read.
 */
const ConfirmationCard = (props: ConfirmationCardProps) => {
  const { id, message, confirmation, onAllow, onKeep } = props

  const lines = confirmation
    ? [
        ...confirmation.removals.hotels.map((hotel) => {
          return T.remove(hotel.name)
        }),
        ...confirmation.removals.programmes.map(T.remove),
        ...(confirmation.changes.destination
          ? [T.change(T.destination, confirmation.changes.destination.from, confirmation.changes.destination.to)]
          : []),
        ...(confirmation.changes.nights
          ? [T.change(T.nights, String(confirmation.changes.nights.from), String(confirmation.changes.nights.to))]
          : []),
      ]
    : []

  return (
    <div
      className="m-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm"
      data-interrupt-id={id}
      data-testid="interrupt-prompt"
    >
      <p className="font-semibold">{T.title}</p>
      {lines.length > 0 ? (
        <ul className="my-2 list-disc pl-5" data-testid="interrupt-changes">
          {lines.map((line) => {
            return <li key={line}>{line}</li>
          })}
        </ul>
      ) : (
        <p className="my-2">{message}</p>
      )}
      <div className="flex gap-2">
        <button className="rounded bg-slate-900 px-3 py-1 text-white" type="button" onClick={onAllow}>
          {T.allow}
        </button>
        <button className="rounded border px-3 py-1" type="button" onClick={onKeep}>
          {T.keep}
        </button>
      </div>
    </div>
  )
}

const isTripPlanConfirmation = (event: InterruptEvent): boolean => {
  return (event.value as { reason?: unknown } | undefined)?.reason === TRIP_PLAN_CONFIRM_REASON
}

// AG-UI interrupts: a decline is a `resolved` answer with `approved: false`; `cancel()` is left for a
// question nobody answered.
const renderConfirmation: Parameters<typeof useInterrupt>[0]['render'] = (props) => {
  const { interrupt, resolve } = props

  return (
    <ConfirmationCard
      id={interrupt?.id}
      message={interrupt?.message}
      confirmation={interrupt?.metadata as TripPlanConfirmation | undefined}
      onAllow={() => {
        void resolve({ approved: true })
      }}
      onKeep={() => {
        void resolve({ approved: false })
      }}
    />
  )
}

/** The confirmation inside the transcript, after the turn that asked. Goes in `AIChat`'s `children`. */
export const InChatTripPlanConfirmation = () => {
  useInterrupt({ enabled: isTripPlanConfirmation, render: renderConfirmation })

  return null
}

interface HeadlessTripPlanConfirmationProps {
  /** The element beside the chat the card is drawn into; nothing renders until it exists. */
  slot: Element | null
}

/** The same card, drawn outside the chat: `renderInChat: false` hands the element back to place. */
export const HeadlessTripPlanConfirmation = (props: HeadlessTripPlanConfirmationProps) => {
  const { slot } = props

  const card = useInterrupt({ renderInChat: false, enabled: isTripPlanConfirmation, render: renderConfirmation })

  return card && slot ? createPortal(card, slot) : null
}

export const TALK_PAST_CONFIRMATION_MESSAGE = 'Actually, which one has the better pool?'

/**
 * Sends one more message while the confirmation waits — what a traveller does when they type instead
 * of answering, through the same `copilotkit.runAgent` the chat's own input calls. Goes in `AIChat`'s
 * `children`. Renders nothing.
 */
export const TalkPastConfirmation = () => {
  const { agent } = useAgent({ updates: [] })
  const { copilotkit } = useCopilotKit()
  const awaiting = useAwaitingInterrupt()

  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current || !awaiting) return

    sentRef.current = true
    agent.addMessage({ id: 'talk-past-confirmation', role: 'user', content: TALK_PAST_CONFIRMATION_MESSAGE })
    void copilotkit.runAgent({ agent })
  }, [agent, awaiting, copilotkit])

  return null
}

const T = {
  title: 'The assistant wants to change your trip plan',
  remove: (name: string) => {
    return `Remove ${name}`
  },
  destination: 'Destination',
  nights: 'Nights',
  change: (field: string, from: string, to: string) => {
    return `${field}: ${from} → ${to}`
  },
  allow: 'Allow',
  keep: 'Keep my plan',
}
