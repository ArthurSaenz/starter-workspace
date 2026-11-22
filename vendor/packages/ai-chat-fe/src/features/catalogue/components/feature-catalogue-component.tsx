import { cn } from '../../../lib/utils.js'
import type { Area, Feature } from '../types.js'

interface FeatureCatalogueComponentProps {
  /** The registry, passed in: a dumb component does not import services. */
  features: readonly Feature[]
  /** Area titles for the group headings; an area with no feature is skipped. */
  areas: readonly Area[]
  className?: string
}

export const FeatureCatalogueComponent = (props: FeatureCatalogueComponentProps) => {
  const { features, areas, className } = props

  return (
    <div data-testid="catalogue" className={cn('space-y-8 text-sm', className)}>
      {areas.map((area) => {
        const rows = features.filter((feature) => {
          return feature.area === area.id
        })

        if (rows.length === 0) return null

        return (
          <section key={area.id} data-testid="catalogue-area" data-area-id={area.id}>
            <h3 className="mb-2 text-base font-semibold">
              {area.title} <span className="font-normal text-gray-500">({rows.length})</span>
            </h3>
            <table className="border-collapse">
              <thead>
                <tr className="border-b border-gray-300 text-left">
                  <th className="py-1 pr-3">{T.feature}</th>
                  <th className="py-1 pr-3">{T.summary}</th>
                  <th className="py-1 pr-3">{T.status}</th>
                  <th className="py-1 pr-3">{T.seam}</th>
                  <th className="py-1">{T.stories}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((feature) => {
                  return (
                    <tr
                      key={feature.id}
                      data-testid="catalogue-feature"
                      data-feature-id={feature.id}
                      data-status={feature.status}
                      className="border-b border-gray-100 align-top"
                    >
                      <td className="py-1 pr-3 font-medium">{feature.title}</td>
                      <td className="py-1 pr-3">{feature.summary}</td>
                      <td className="py-1 pr-3">
                        {feature.status}
                        {feature.blockedBy ? ` (${feature.blockedBy.join(', ')})` : ''}
                      </td>
                      <td className="py-1 pr-3">
                        <code>{seamText(feature.seam)}</code>
                      </td>
                      <td className="py-1">{feature.stories.length > 0 ? feature.stories.join(', ') : T.noStories}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

// Same rendering as `services/render-markdown.ts`'s `seamLabel`; a dumb component cannot import
// services, so the six-line switch is repeated rather than routed through a prop.
const seamText = (seam: Feature['seam']): string => {
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

const T = {
  feature: 'Feature',
  summary: 'Summary',
  status: 'Status',
  seam: 'Seam',
  stories: 'Stories',
  noStories: '—',
}
