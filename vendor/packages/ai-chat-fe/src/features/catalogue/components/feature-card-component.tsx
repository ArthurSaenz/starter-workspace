import { cn } from '../../../lib/utils.js'
import type { Feature, FeatureStatus, Seam } from '../types.js'

interface FeatureCardComponentProps {
  feature: Feature
  /** Frames or `/info` flags the story's fake supplies; non-empty only on `FakeOnly_*` stories. */
  fakeSupplies?: readonly string[]
  /** The runtime route the story exercises and the Lambda answers 404 — the denial IS the demo. */
  deniedRoute?: string
  className?: string
}

export const FeatureCardComponent = (props: FeatureCardComponentProps) => {
  const { feature, fakeSupplies = [], deniedRoute, className } = props

  return (
    <section
      data-testid="catalogue-feature-card"
      data-feature-id={feature.id}
      className={cn('rounded-md border border-gray-200 p-4 text-sm', className)}
    >
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">{feature.title}</h3>
        <span
          data-testid="catalogue-status"
          data-status={feature.status}
          className={cn('rounded px-2 py-0.5 text-xs', STATUS_CLASS[feature.status])}
        >
          {feature.status}
        </span>
      </header>
      <p className="mt-1">{feature.summary}</p>
      <dl className="mt-2 grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
        {feature.blockedBy ? (
          <>
            <dt>{T.blockedBy}</dt>
            <dd data-testid="catalogue-blocked-by">{feature.blockedBy.join(', ')}</dd>
          </>
        ) : null}
        <dt>{T.seam}</dt>
        <dd data-testid="catalogue-seam">
          <code>{seamText(feature.seam)}</code>
        </dd>
        {feature.caveat ? (
          <>
            <dt>{T.caveat}</dt>
            <dd>{feature.caveat}</dd>
          </>
        ) : null}
      </dl>
      {fakeSupplies.length > 0 ? (
        <p
          role="note"
          data-testid="catalogue-fake-only"
          className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
        >
          {T.fakeOnly} {fakeSupplies.join(', ')}
        </p>
      ) : null}
      {deniedRoute ? (
        <p
          role="note"
          data-testid="catalogue-denied-route"
          className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900"
        >
          {T.deniedRoute} <code>{deniedRoute}</code>
        </p>
      ) : null}
    </section>
  )
}

// Same rendering as `services/render-markdown.ts`'s `seamLabel`; a dumb component cannot import
// services, so the six-line switch is repeated rather than routed through a prop.
const seamText = (seam: Seam): string => {
  switch (seam.kind) {
    case 'chat':
      return seam.path ? `chat.${seam.prop}.${seam.path}` : `chat.${seam.prop}`
    case 'provider':
      return `provider.${seam.prop}`
    case 'features':
      return `features.${seam.prop}`
    case 'top':
      return seam.prop
    case 'children':
      return `children (${seam.hook})`
    case 'none':
      return '—'
  }
}

const STATUS_CLASS: Record<FeatureStatus, string> = {
  on: 'bg-green-100 text-green-900',
  'on-with-caveat': 'bg-lime-100 text-lime-900',
  'off-by-default': 'bg-sky-100 text-sky-900',
  'backend-blocked': 'bg-amber-100 text-amber-900',
  'not-applicable': 'bg-gray-100 text-gray-700',
  'out-of-scope': 'bg-gray-100 text-gray-700',
}

const T = {
  blockedBy: 'Blocked by',
  seam: 'Seam',
  caveat: 'Caveat',
  fakeOnly: 'Fake only — the runtime fake supplies:',
  deniedRoute: 'Denied by the Lambda — the fake answers 404 on',
}
