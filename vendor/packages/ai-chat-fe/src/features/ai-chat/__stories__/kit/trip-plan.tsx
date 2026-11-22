import { UseAgentUpdate, useAgent } from '@copilotkit/react-core/v2'

import { EMPTY_TRIP_PLAN } from '../../__tests__/helpers/index.js'
import type { TripPlan, TripPlanHotel } from '../../__tests__/helpers/index.js'

interface TripPlanPanelProps {
  /** Lets the traveller change the nights and drop a hotel; the change reaches the agent on the next run. */
  editable?: boolean
}

/**
 * The conversation's shared trip plan beside the chat: the agent fills it through `update_trip_plan`
 * (STATE_SNAPSHOT / STATE_DELTA), and with `editable` the traveller edits it through
 * `agent.setState()`. Goes in `AIChat`'s `children`.
 */
export const TripPlanPanel = (props: TripPlanPanelProps) => {
  const { editable = false } = props

  const { agent } = useAgent({ updates: [UseAgentUpdate.OnStateChanged] })
  // Nothing until the first run's STATE_SNAPSHOT: the agent starts with `{}`.
  const plan = (agent.state as { tripPlan?: TripPlan }).tripPlan ?? EMPTY_TRIP_PLAN

  // The whole state, not just the plan: setState replaces it, and the Lambda echoes every key.
  const save = (next: TripPlan) => {
    agent.setState({ ...agent.state, tripPlan: next })
  }

  const changeNights = (by: number) => {
    save({ ...plan, nights: Math.max(1, (plan.nights ?? 1) + by) })
  }

  const removeHotel = (hotelId: string) => {
    save({
      ...plan,
      hotels: plan.hotels.filter((hotel) => {
        return hotel.hotelId !== hotelId
      }),
    })
  }

  return (
    <section aria-label={T.title} className="border-b bg-slate-50 p-3 text-sm" data-testid="trip-plan">
      <p className="font-semibold">
        <span data-testid="trip-plan-destination">{plan.destination ?? T.noDestination}</span>
        {' · '}
        <span data-testid="trip-plan-nights">{plan.nights === null ? T.noNights : T.nights(plan.nights)}</span>
        {editable && plan.nights !== null ? (
          <span className="ml-2 inline-flex gap-1">
            <button
              aria-label={T.fewerNights}
              className="rounded border px-1.5"
              type="button"
              onClick={() => {
                changeNights(-1)
              }}
            >
              −
            </button>
            <button
              aria-label={T.moreNights}
              className="rounded border px-1.5"
              type="button"
              onClick={() => {
                changeNights(1)
              }}
            >
              +
            </button>
          </span>
        ) : null}
      </p>
      {plan.hotels.length === 0 ? (
        <p className="text-slate-500">{T.noHotels}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {plan.hotels.map((hotel) => {
            return (
              <li
                key={hotel.hotelId}
                className={hotel.pending ? 'text-slate-400 italic' : undefined}
                data-pending={hotel.pending === true}
                data-testid="trip-plan-hotel"
              >
                {hotel.name} <span className="text-xs text-slate-500">{hotelFacts(hotel)}</span>
                {editable && !hotel.pending ? (
                  <button
                    className="ml-2 rounded border px-1.5 text-xs"
                    type="button"
                    onClick={() => {
                      removeHotel(hotel.hotelId)
                    }}
                  >
                    {T.remove(hotel.name)}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const T = {
  title: 'Trip plan',
  noDestination: 'No destination yet',
  noNights: 'nights not set',
  nights: (nights: number) => {
    return `${nights} night${nights === 1 ? '' : 's'}`
  },
  noHotels: 'No hotels yet — ask the assistant to shortlist some.',
  checking: 'checking the catalogue…',
  fewerNights: 'One night fewer',
  moreNights: 'One night more',
  remove: (name: string) => {
    return `Remove ${name}`
  },
}

const hotelFacts = (hotel: TripPlanHotel): string => {
  if (hotel.pending) return T.checking

  return [hotel.chain, hotel.area, hotel.stars === null ? null : `${hotel.stars}★`].filter(Boolean).join(' · ')
}
