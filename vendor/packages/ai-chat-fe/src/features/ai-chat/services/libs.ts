import { basicCatalogV1, createCatalog, filterCatalog } from '@copilotkit/a2ui-renderer'
import type { CatalogDefinitions, CatalogRenderers } from '@copilotkit/a2ui-renderer'
import type { ReactActivityMessageRenderer } from '@copilotkit/react-core/v2'

type StandardSchemaV1<T> = ReactActivityMessageRenderer<T>['content']

export const A2UI_SURFACE_ACTIVITY_TYPE = 'a2ui-surface'

/**
 * The basic-catalog components the agent's server catalog offers (`A2UI_CATALOG_SCHEMA`,
 * `@pkg/ai-travel-agent`). react-core draws with the whole basic catalog, whose Image, Video and
 * AudioPlayer load any URL they are handed — a request a prompt-injected surface could point at an
 * attacker's host. A host catalog (`extendBasicA2uiCatalog`) adds its own components to these.
 */
export const A2UI_ALLOWED_COMPONENTS: ReadonlySet<string> = new Set([
  'Column',
  'Row',
  'List',
  'Card',
  'Text',
  'Divider',
  'Icon',
  'Button',
])

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Swapped for an empty Text rather than dropped, so a parent's `children` never names a missing id.
const allowedComponent = (component: unknown, allowed: ReadonlySet<string>): unknown => {
  if (!isRecord(component) || allowed.has(String(component.component))) return component

  return { id: component.id, component: 'Text', text: '' }
}

const isV1Operation = (operation: Record<string, unknown>): boolean => {
  return operation.version === '1.0'
}

const V1_ID = /^\w+$/

/**
 * A2UI 1.0 takes component ids of letters, digits and underscores only, and the renderer refuses the
 * whole surface over one `card-1` — while the server middleware lets it through, so no retry follows
 * and the traveller would get an error card. Models write hyphens by habit; this maps each such id to
 * its underscore spelling. An id whose new spelling is already taken is left for the renderer to refuse.
 */
const v1IdRenames = (components: readonly unknown[]): ReadonlyMap<string, string> => {
  const ids = components.flatMap((component) => {
    return isRecord(component) && typeof component.id === 'string' ? [component.id] : []
  })

  const taken = new Set(ids)
  const renames = new Map<string, string>()

  for (const id of ids) {
    const renamed = id.replace(/\W/g, '_')

    if (V1_ID.test(id) || taken.has(renamed)) continue

    taken.add(renamed)
    renames.set(id, renamed)
  }

  return renames
}

// The places a basic or host component names another one: its own id, `child`, `children` (ids, or a
// template's `componentId`).
const withRenamedIds = (component: unknown, renames: ReadonlyMap<string, string>): unknown => {
  if (renames.size === 0 || !isRecord(component)) return component

  const renamed = (value: unknown): unknown => {
    return typeof value === 'string' ? (renames.get(value) ?? value) : value
  }

  const { children } = component

  return {
    ...component,
    id: renamed(component.id),
    ...('child' in component ? { child: renamed(component.child) } : {}),
    ...(Array.isArray(children) ? { children: children.map(renamed) } : {}),
    ...(isRecord(children) ? { children: { ...children, componentId: renamed(children.componentId) } } : {}),
  }
}

// Every key that carries a `components` array, not `updateComponents` alone: A2UI 1.0 lets
// `createSurface` hold components inline, and a later protocol may add another carrier.
const allowedOperation = (operation: unknown, allowList: A2uiAllowList): unknown => {
  if (!isRecord(operation)) return operation

  // The renderer draws each surface with the basic catalog of its own protocol (react-core 1.88
  // registers the host catalog plus the other protocol's whole basic catalog), so the set follows the op.
  const allowed = isV1Operation(operation) ? allowList.v1_0 : allowList.v0_9

  const carriers = Object.entries(operation).filter((entry): entry is [string, Record<string, unknown>] => {
    return isRecord(entry[1]) && Array.isArray(entry[1].components)
  })

  if (carriers.length === 0) return operation

  return {
    ...operation,
    ...Object.fromEntries(
      carriers.map(([key, carrier]) => {
        const listed = carrier.components as unknown[]
        const renames = isV1Operation(operation) ? v1IdRenames(listed) : new Map<string, string>()

        const components = listed.map((component) => {
          return withRenamedIds(allowedComponent(component, allowed), renames)
        })

        return [key, { ...carrier, components }]
      }),
    ),
  }
}

/** The components a surface may hold, per protocol of the operation that carries them. */
export interface A2uiAllowList {
  readonly v0_9: ReadonlySet<string>
  readonly v1_0: ReadonlySet<string>
}

const BASIC_ALLOW_LIST: A2uiAllowList = { v0_9: A2UI_ALLOWED_COMPONENTS, v1_0: A2UI_ALLOWED_COMPONENTS }

/** `content` with every component outside the allow-list blanked; anything else passes as is. */
export const allowedSurfaceContent = (content: unknown, allowList: A2uiAllowList = BASIC_ALLOW_LIST): unknown => {
  if (!isRecord(content) || !Array.isArray(content.a2ui_operations)) return content

  return {
    ...content,
    a2ui_operations: content.a2ui_operations.map((operation) => {
      return allowedOperation(operation, allowList)
    }),
  }
}

// Synchronous: react-core drops an activity whose validation returns a Promise.
export const a2uiSurfaceContentSchema = (allowList: A2uiAllowList): StandardSchemaV1<unknown> => {
  return {
    '~standard': {
      version: 1,
      vendor: '@wl/ai-chat-fe',
      validate: (value) => {
        return { value: allowedSurfaceContent(value, allowList) }
      },
    },
  }
}

// zod 3, the one `@copilotkit/a2ui-renderer` types its definitions with: a zod 4 schema is not a
// `ZodObject` to it. The alias resolves to the renderer's own copy, so the bundle gains nothing.
export { z as a2uiProps } from 'zod-v3'
export type { CatalogDefinitions as A2uiCatalogDefinitions, CatalogRenderers as A2uiCatalogRenderers }

/** What `provider.a2ui.catalog` takes; only the component names are read on this side. */
export interface A2uiCatalog {
  readonly id: string
  readonly protocolVersion?: string
  readonly components: ReadonlyMap<string, unknown>
}

/**
 * The basic catalog's allowed components plus the host's own, as one catalog for
 * `provider.a2ui.catalog`.
 *
 * A2UI 1.0, under the 1.0 basic catalog's id: a surface names the catalog it was drawn with, a stored
 * chat replays that name, and the renderer refuses a surface whose catalog it does not hold. The rest
 * of the basic catalog (Image, Video, AudioPlayer…) is left out of it. A stored v0.9 surface replays
 * through the renderer's whole v0.9 basic catalog instead, so only the surface guard keeps media out
 * of those (`a2uiAllowedComponents`).
 */
export const extendBasicA2uiCatalog = <D extends CatalogDefinitions>(
  definitions: D,
  renderers: CatalogRenderers<D>,
): A2uiCatalog => {
  const catalog = createCatalog(definitions, renderers, {
    catalogId: basicCatalogV1.id,
    includeBasicCatalog: true,
    protocolVersion: '1.0',
  })

  return filterCatalog(catalog, (name) => {
    return A2UI_ALLOWED_COMPONENTS.has(name) || Object.hasOwn(definitions, name)
  })
}

/**
 * The components a surface may hold: the provider catalog's under its protocol, the basic allow-list
 * under the other one. A host component in the other protocol's surface is blanked too: that
 * protocol's basic catalog cannot draw it, and one unknown component fails the whole surface.
 */
export const a2uiAllowedComponents = (catalog: A2uiCatalog | undefined): A2uiAllowList => {
  if (!catalog) return BASIC_ALLOW_LIST

  const own = new Set(catalog.components.keys())

  return catalog.protocolVersion === '1.0'
    ? { v0_9: A2UI_ALLOWED_COMPONENTS, v1_0: own }
    : { v0_9: own, v1_0: A2UI_ALLOWED_COMPONENTS }
}
