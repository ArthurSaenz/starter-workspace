import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { StartRun } from '../__stories__/kit/start-run.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import { a2uiProps, extendBasicA2uiCatalog } from '../services/libs.js'
import {
  A2UI_ACTION_REPLY,
  A2UI_ADD_ACTION,
  A2UI_BASIC_CATALOG_ID_V1_0,
  A2UI_COMPARISON_COMPONENTS,
  A2UI_INTRO,
  A2UI_SURFACE_ID,
  NOMADREAM_PRESET,
  OPEN_GENUI_REPLY,
  a2uiSurfaceFrames,
  a2uiSurfaceOperations,
  installRuntimeScenario,
  scenarios,
} from './helpers/index.js'
import type { FakeRuntime, KeptThread, RuntimeScenario } from './helpers/index.js'

// Generative UI the agent drives: A2UI surfaces (on in the product) and Open Generative UI
// (story-only). Each asserts the rendered transcript and what went back on the wire.

const QUESTION = 'Compare Park Hyatt Bangkok and JW Marriott Hotel Bangkok side by side'
const ADD_BUTTON = 'Add to trip plan'
// `@copilotkit/react-core`'s A2UI catalog context; with `includeSchema: false` only the first goes out.
const A2UI_CAPABILITIES_CONTEXT = 'A2UI catalog capabilities'
const A2UI_SCHEMA_CONTEXT = 'A2UI Component Schema'
const EXFIL_URL = 'https://exfil.example/leak'

const HOST_BADGE_LABEL = 'Host badge label'

const HOST_CATALOG = extendBasicA2uiCatalog(
  { HostBadge: { props: a2uiProps.object({ label: a2uiProps.string() }) } },
  {
    HostBadge: (renderer) => {
      const { props } = renderer

      return <span data-testid="host-badge">{props.label}</span>
    },
  },
)

const HOST_A2UI = { ...NOMADREAM_PRESET.provider.a2ui, catalog: HOST_CATALOG }

const HEADING_MARKS: Record<string, string> = { h3: '### ', h4: '#### ' }

const identifier = (id: unknown): unknown => {
  return typeof id === 'string' ? id.replaceAll('-', '_') : id
}

// The comparison as the 1.0 catalog asks for it: no heading variant (a heading is Markdown), and every
// id a UAX #31 identifier, or the renderer refuses the whole surface.
const V1_COMPARISON_COMPONENTS = A2UI_COMPARISON_COMPONENTS.map((component) => {
  const { variant, ...rest } = component
  const mark = typeof variant === 'string' ? HEADING_MARKS[variant] : undefined

  const ids = {
    id: identifier(rest.id),
    ...(rest.child === undefined ? {} : { child: identifier(rest.child) }),
    ...(Array.isArray(rest.children) ? { children: rest.children.map(identifier) } : {}),
  }

  if (mark) return { ...rest, ...ids, text: `${mark}${String(rest.text)}` }

  return variant === undefined ? { ...rest, ...ids } : { ...rest, ...ids, variant }
})

const withExtras = (components: Array<Record<string, unknown>>, extras: Array<Record<string, unknown>>) => {
  const [root, ...rest] = components

  return [
    {
      ...root,
      children: [
        ...((root?.children as string[] | undefined) ?? []),
        ...extras.map((extra) => {
          return String(extra.id)
        }),
      ],
    },
    ...rest,
    ...extras,
  ]
}

const mount = (element: ReactElement) => {
  return render(<div style={{ height: 700 }}>{element}</div>)
}

const contextDescriptionsOf = (runtime: FakeRuntime, run: number): string[] => {
  return (runtime.runs[run]?.body.context ?? []).map((entry) => {
    return entry.description
  })
}

const toolNamesOf = (runtime: FakeRuntime, run: number): string[] => {
  return (runtime.runs[run]?.body.tools ?? []).map((tool) => {
    return tool.name
  })
}

const sandboxFrames = (): HTMLIFrameElement[] => {
  return [...document.querySelectorAll<HTMLIFrameElement>('[data-ai-chat] iframe')]
}

describe('generative UI', () => {
  let runtime: FakeRuntime | undefined

  afterEach(() => {
    runtime?.restore()
    runtime = undefined
  })

  describe('a2UI', () => {
    it('draws the surface the middleware streams inside the transcript', async () => {
      runtime = installRuntimeScenario(scenarios.a2uiComparison)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByText(A2UI_INTRO)).toBeVisible()
      await expect.element(screen.getByText('Bangkok: Park Hyatt vs JW Marriott')).toBeVisible()
      await expect.element(screen.getByText('Park Hyatt Bangkok', { exact: true })).toBeVisible()
      await expect.element(screen.getByText('JW Marriott Hotel Bangkok', { exact: true })).toBeVisible()
      expect(screen.getByRole('button', { name: ADD_BUTTON }).elements()).toHaveLength(2)
      // The call itself renders nothing: react-core's no-op `render_a2ui` renderer claims it.
      expect(document.body.textContent).not.toContain('render_a2ui')
    })

    // The Lambda's server-side schema is what the model reads; the browser's 50 kB copy stays home.
    it('sends the catalog capabilities but not the browser schema (`includeSchema: false`)', async () => {
      runtime = installRuntimeScenario(scenarios.a2uiComparison)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByText(A2UI_INTRO)).toBeVisible()

      const descriptions = contextDescriptionsOf(runtime, 0)

      expect(
        descriptions.some((description) => {
          return description.startsWith(A2UI_CAPABILITIES_CONTEXT)
        }),
      ).toBe(true)
      expect(
        descriptions.some((description) => {
          return description.startsWith(A2UI_SCHEMA_CONTEXT)
        }),
      ).toBe(false)
    })

    it('posts a button click as a new run carrying forwardedProps.a2uiAction, and shows the answer', async () => {
      runtime = installRuntimeScenario(scenarios.a2uiComparison)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await screen.getByRole('button', { name: ADD_BUTTON }).first().click()

      await expect.element(screen.getByText(A2UI_ACTION_REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(2)
      expect(runtime.runs[1]?.body.forwardedProps?.a2uiAction).toEqual({
        userAction: expect.objectContaining({
          name: A2UI_ADD_ACTION,
          surfaceId: A2UI_SURFACE_ID,
          sourceComponentId: 'add-1',
          context: { hotelId: 'hotel-park-hyatt-bangkok', hotelName: 'Park Hyatt Bangkok' },
        }),
      })
    })

    it('draws nothing while /info reports A2UI off', async () => {
      const off: RuntimeScenario = {
        ...scenarios.a2uiComparison,
        info: { overrides: { a2uiEnabled: false, a2ui: { enabled: false } } },
      }

      runtime = installRuntimeScenario(off)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByText(A2UI_INTRO)).toBeVisible()
      expect(screen.getByRole('button', { name: ADD_BUTTON }).elements()).toHaveLength(0)
      expect(
        contextDescriptionsOf(runtime, 0).some((description) => {
          return description.startsWith(A2UI_CAPABILITIES_CONTEXT)
        }),
      ).toBe(false)
    })
    // The basic catalog's media components load any URL; an injected surface must not make the browser fetch one.
    it('draws no Image, Video or AudioPlayer, and the rest of the surface still', async () => {
      const [root, ...rest] = A2UI_COMPARISON_COMPONENTS

      const withMedia: RuntimeScenario = {
        run: {
          kind: 'frames',
          frames: a2uiSurfaceFrames({
            surfaceId: A2UI_SURFACE_ID,
            components: [
              { ...root, children: [...((root?.children as string[] | undefined) ?? []), 'img', 'video', 'audio'] },
              ...rest,
              { id: 'img', component: 'Image', url: `${EXFIL_URL}/img` },
              { id: 'video', component: 'Video', url: `${EXFIL_URL}/video` },
              { id: 'audio', component: 'AudioPlayer', url: `${EXFIL_URL}/audio` },
            ],
            text: A2UI_INTRO,
          }),
        },
      }

      runtime = installRuntimeScenario(withMedia)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByText('Bangkok: Park Hyatt vs JW Marriott')).toBeVisible()
      expect(document.body.innerHTML).not.toContain(EXFIL_URL)
      expect(document.querySelectorAll('[data-ai-chat] img, [data-ai-chat] video, [data-ai-chat] audio')).toHaveLength(
        0,
      )
    })

    // The 1.0 renderer refuses a surface over a hyphenated id; the server middleware does not catch it.
    it('paints a 1.0 surface whose ids the model wrote with hyphens', async () => {
      const hyphenated: RuntimeScenario = {
        run: {
          kind: 'frames',
          frames: a2uiSurfaceFrames({
            surfaceId: A2UI_SURFACE_ID,
            version: '1.0',
            components: [
              { id: 'root', component: 'Column', children: ['card-1'] },
              { id: 'card-1', component: 'Card', child: 'name-1' },
              { id: 'name-1', component: 'Text', text: 'Hyphenated hotel' },
            ],
            text: A2UI_INTRO,
          }),
        },
      }

      runtime = installRuntimeScenario(hyphenated)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByText('Hyphenated hotel')).toBeVisible()
      expect(document.querySelector('[data-ai-chat] [role="alert"]')).toBeNull()
    })

    // A host catalog: its own component is drawn beside the basic ones, and the media stay out.
    it('draws a host catalog component, and still no Image', async () => {
      const withHostComponent: RuntimeScenario = {
        run: {
          kind: 'frames',
          frames: a2uiSurfaceFrames({
            surfaceId: A2UI_SURFACE_ID,
            version: '1.0',
            components: withExtras(V1_COMPARISON_COMPONENTS, [
              { id: 'badge', component: 'HostBadge', label: HOST_BADGE_LABEL },
              { id: 'img', component: 'Image', url: `${EXFIL_URL}/img` },
            ]),
            text: A2UI_INTRO,
          }),
        },
      }

      runtime = installRuntimeScenario(withHostComponent)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ ...NOMADREAM_PRESET.provider, a2ui: HOST_A2UI }}>
          <StartRun message={QUESTION} />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('host-badge')).toHaveTextContent(HOST_BADGE_LABEL)
      await expect.element(screen.getByRole('heading', { name: 'Bangkok: Park Hyatt vs JW Marriott' })).toBeVisible()
      expect(document.body.innerHTML).not.toContain(EXFIL_URL)
      expect([...HOST_CATALOG.components.keys()]).not.toContain('Image')
      expect(HOST_CATALOG.id).toBe(A2UI_BASIC_CATALOG_ID_V1_0)
      expect(HOST_CATALOG.protocolVersion).toBe('1.0')
    })

    // A chat kept before the 1.0 catalog replays its v0.9 surface through the renderer's whole v0.9
    // basic catalog: the guard alone keeps Image out there, and blanks a host component that catalog
    // cannot draw rather than let it fail the surface.
    it('paints a kept v0.9 surface beside a 1.0 one with a host component in one chat', async () => {
      const v09Extras = [
        { id: 'old-badge', component: 'HostBadge', label: 'Old badge' },
        { id: 'old-img', component: 'Image', url: `${EXFIL_URL}/old` },
      ]

      const v09Components = withExtras(A2UI_COMPARISON_COMPONENTS, v09Extras).map((component) => {
        return component.id === 'title' ? { ...component, text: 'Kept v0.9 comparison' } : component
      })

      const v1Components = withExtras(
        V1_COMPARISON_COMPONENTS.map((component) => {
          return component.id === 'title' ? { ...component, text: '### New 1.0 comparison' } : component
        }),
        [
          { id: 'badge', component: 'HostBadge', label: HOST_BADGE_LABEL },
          { id: 'img', component: 'Image', url: `${EXFIL_URL}/new` },
        ],
      )

      const surfaceTurn = (
        callId: string,
        surfaceId: string,
        components: Array<Record<string, unknown>>,
        version: 'v0.9' | '1.0',
      ) => {
        return [
          {
            id: `assistant-${callId}`,
            role: 'assistant',
            content: A2UI_INTRO,
            toolCalls: [
              {
                id: callId,
                type: 'function',
                function: { name: 'render_a2ui', arguments: JSON.stringify({ surfaceId, components }) },
              },
            ],
          },
          {
            id: `${callId}-rendered`,
            role: 'tool',
            toolCallId: callId,
            content: JSON.stringify({ status: 'rendered' }),
          },
          {
            id: `a2ui-surface-${callId}`,
            role: 'activity',
            activityType: 'a2ui-surface',
            content: { a2ui_operations: a2uiSurfaceOperations(surfaceId, components, version) },
          },
        ]
      }

      const kept: KeptThread = {
        id: 'chat-mixed-protocols',
        name: 'Bangkok comparisons',
        messages: [
          { id: 'u1', role: 'user', content: QUESTION },
          ...surfaceTurn('call-old', 'old-surface', v09Components, 'v0.9'),
          { id: 'u2', role: 'user', content: 'And again, please' },
          ...surfaceTurn('call-new', 'new-surface', v1Components, '1.0'),
        ],
      }

      runtime = installRuntimeScenario({ ...scenarios.default, threads: [kept] })

      const screen = await mount(
        <AIChat
          {...NOMADREAM_PRESET}
          provider={{ ...NOMADREAM_PRESET.provider, a2ui: HOST_A2UI }}
          chat={{ threadId: kept.id }}
        />,
      )

      await expect.element(screen.getByText('Kept v0.9 comparison')).toBeVisible()
      await expect.element(screen.getByRole('heading', { name: 'New 1.0 comparison' })).toBeVisible()
      await expect.element(screen.getByTestId('host-badge')).toHaveTextContent(HOST_BADGE_LABEL)
      expect(screen.getByTestId('host-badge').elements()).toHaveLength(1)
      expect(screen.getByRole('button', { name: ADD_BUTTON }).elements()).toHaveLength(4)
      expect(document.body.innerHTML).not.toContain(EXFIL_URL)
    })
  })

  describe('open Generative UI', () => {
    it('registers generateSandboxedUi and renders the sandboxed HTML when /info enables it', async () => {
      runtime = installRuntimeScenario(scenarios.openGenerativeUi)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="Sketch my stay" />
        </AIChat>,
      )

      await expect.poll(sandboxFrames).toHaveLength(1)
      // The browser's handler answers the call, so react-core runs again and the reply lands.
      await expect.element(screen.getByText(OPEN_GENUI_REPLY)).toBeVisible()
      expect(toolNamesOf(runtime, 0)).toContain('generateSandboxedUi')
    })

    it('stays off — no tool on the wire, nothing drawn — while /info and the provider leave it off', async () => {
      const off: RuntimeScenario = { ...scenarios.openGenerativeUi, info: 'ok' }

      runtime = installRuntimeScenario(off)

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET}>
          <StartRun message="Sketch my stay" />
        </AIChat>,
      )

      await expect.element(screen.getByTestId('copilot-assistant-message').first()).toBeInTheDocument()
      expect(toolNamesOf(runtime, 0)).not.toContain('generateSandboxedUi')
      expect(sandboxFrames()).toHaveLength(0)
    })

    // The caveat on the registry row: react-core turns the feature on for a passed prop alone.
    it('switches on in the browser from `provider.openGenerativeUI` alone, whatever /info says', async () => {
      runtime = installRuntimeScenario({ ...scenarios.openGenerativeUi, info: 'ok' })

      const screen = await mount(
        <AIChat {...NOMADREAM_PRESET} provider={{ ...NOMADREAM_PRESET.provider, openGenerativeUI: {} }}>
          <StartRun message="Sketch my stay" />
        </AIChat>,
      )

      await expect.element(screen.getByText(OPEN_GENUI_REPLY)).toBeVisible()
      expect(toolNamesOf(runtime, 0)).toContain('generateSandboxedUi')
    })
  })
})
