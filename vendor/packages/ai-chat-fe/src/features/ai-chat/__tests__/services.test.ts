import { describe, expect, it } from 'vitest'

import { a2uiAllowedComponents, a2uiProps, allowedSurfaceContent, extendBasicA2uiCatalog } from '../services/libs.js'
import { describeChatFailure } from '../services/main.js'

// @ag-ui/client's fetch wrapper: `Error("HTTP <status>: <body>")` with `.status` attached.
const httpError = (status: unknown, body = '{}') => {
  return Object.assign(new Error(`HTTP ${String(status)}: ${body}`), { status })
}

describe('describeChatFailure', () => {
  it("a RUN_ERROR frame is shown with the Lambda's own sentence", () => {
    const error = new Error('The assistant took too long to respond.')

    expect(describeChatFailure({ code: 'agent_run_error_event', error })).toEqual({
      kind: 'run-error',
      text: 'The assistant took too long to respond.',
    })
  })

  it('a RUN_ERROR frame with an empty message falls through to unavailable', () => {
    // A frame whose `message` is blank — built without the constructor so the lint rule that
    // forbids `new Error('')` does not hide the case under test.
    const error = Object.assign(new Error('placeholder'), { message: '' })

    expect(describeChatFailure({ code: 'agent_run_error_event', error })).toEqual({
      kind: 'unavailable',
      text: 'The assistant is unavailable right now. Please try again.',
    })
  })

  it('a RUN_ERROR coded CONVERSATION_NOT_KEPT asks for a new chat instead of showing its message', () => {
    const error = Object.assign(new Error('The conversation could not be continued.'), {
      code: 'CONVERSATION_NOT_KEPT',
    })

    expect(describeChatFailure({ code: 'agent_run_error_event', error })).toEqual({
      kind: 'not-kept',
      text: "This conversation can't continue. Start a new chat.",
    })
  })

  it('the not-kept code carried in the message alone maps the same way', () => {
    const error = new Error('CONVERSATION_NOT_KEPT')

    expect(describeChatFailure({ code: 'agent_run_error_event', error }).kind).toBe('not-kept')
  })

  it('a RUN_ERROR coded CONVERSATION_CHANGED says another tab changed the chat instead of showing its message', () => {
    const error = Object.assign(new Error('The conversation changed.'), { code: 'CONVERSATION_CHANGED' })

    expect(describeChatFailure({ code: 'agent_run_error_event', error })).toEqual({
      kind: 'conversation-changed',
      text: 'This chat changed in another tab.',
    })
  })

  it('a 503 QUOTA_UNAVAILABLE is a brief, retryable blip; any other 503 stays unavailable', () => {
    const quota = Object.assign(new Error('HTTP 503: {"type":"QUOTA_UNAVAILABLE"}'), { status: 503 })
    const other = Object.assign(new Error('HTTP 503: {"error":"Service Unavailable"}'), { status: 503 })

    expect(describeChatFailure({ code: 'agent_run_failed_event', error: quota })).toEqual({
      kind: 'quota-unavailable',
      text: 'The assistant is briefly unavailable. Try again.',
    })
    expect(describeChatFailure({ code: 'agent_run_failed_event', error: other }).kind).toBe('unavailable')
  })

  it('a failed runtime handshake is offline — reload, not retry', () => {
    const error = new Error('Runtime info request failed with status 404')

    expect(describeChatFailure({ code: 'runtime_info_fetch_failed', error })).toEqual({
      kind: 'offline',
      text: 'The assistant is unavailable right now. Reload the page to try again.',
    })
  })

  it('hTTP 401 is a session expiry', () => {
    expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError(401) })).toEqual({
      kind: 'session-expired',
      text: 'Your session has expired — sign in again to continue.',
    })
  })

  it('hTTP 413 is a too-long conversation', () => {
    expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError(413) })).toEqual({
      kind: 'too-long',
      text: 'This conversation got too long — start a new one.',
    })
  })

  it('hTTP 429 is a throttle', () => {
    expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError(429) })).toEqual({
      kind: 'throttled',
      text: 'Too many requests — give it a minute and try again.',
    })
  })

  it("hTTP 429 with the daily-quota body is today's limit, not a throttle to wait out", () => {
    const body = JSON.stringify({ error: 'limit', type: 'DAILY_QUOTA_EXCEEDED' })

    expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError(429, body) })).toEqual({
      kind: 'quota-exceeded',
      text: "You've reached today's assistant limit. It resets at midnight UTC.",
    })
  })

  it('any other HTTP status is unavailable', () => {
    for (const status of [400, 404, 500, 502, 503]) {
      expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError(status) }).kind).toBe('unavailable')
    }
  })

  it('the status is read from the Error object, not parsed from its message', () => {
    // Message says 401, the attached status says 500: the attached status wins.
    const error = Object.assign(new Error('HTTP 401: {}'), { status: 500 })

    expect(describeChatFailure({ code: 'agent_run_failed_event', error }).kind).toBe('unavailable')
  })

  it('a non-numeric status is unavailable', () => {
    expect(describeChatFailure({ code: 'agent_run_failed_event', error: httpError('429') }).kind).toBe('unavailable')
  })

  it('an error without a status (network failure) is unavailable', () => {
    const error = new TypeError('Failed to fetch')

    expect(describeChatFailure({ code: 'agent_run_failed_event', error })).toEqual({
      kind: 'unavailable',
      text: 'The assistant is unavailable right now. Please try again.',
    })
  })

  it('the second HTTP-failure code maps the same way as the first', () => {
    // The provider fires `onError` twice for one failed run (`agent_run_failed_event`, then
    // `agent_run_failed`); both must land on the same line.
    expect(describeChatFailure({ code: 'agent_run_failed', error: httpError(401) })).toEqual(
      describeChatFailure({ code: 'agent_run_failed_event', error: httpError(401) }),
    )
  })
})

describe('allowedSurfaceContent', () => {
  const image = { id: 'photo', component: 'Image', url: 'https://attacker.example/pixel.png' }
  const blanked = { id: 'photo', component: 'Text', text: '' }
  const root = { id: 'root', component: 'Column', children: ['photo'] }

  it('blanks a component outside the catalog in updateComponents', () => {
    const content = {
      a2ui_operations: [{ version: 'v0.9', updateComponents: { surfaceId: 's', components: [root, image] } }],
    }

    expect(allowedSurfaceContent(content)).toEqual({
      a2ui_operations: [{ version: 'v0.9', updateComponents: { surfaceId: 's', components: [root, blanked] } }],
    })
  })

  it('blanks a component A2UI 1.0 carries inline in createSurface', () => {
    const content = {
      a2ui_operations: [
        { version: '1.0', createSurface: { surfaceId: 's', catalogId: 'c', components: [root, image] } },
      ],
    }

    expect(allowedSurfaceContent(content)).toEqual({
      a2ui_operations: [
        { version: '1.0', createSurface: { surfaceId: 's', catalogId: 'c', components: [root, blanked] } },
      ],
    })
  })

  // The 1.0 renderer refuses a whole surface over one hyphenated id, and the server lets it through.
  it('respells a hyphenated id in a 1.0 operation, wherever a component names it', () => {
    const components = [
      { id: 'root', component: 'Column', children: ['card-1', 'list_1'] },
      { id: 'card-1', component: 'Card', child: 'name-1' },
      { id: 'name-1', component: 'Text', text: 'card-1 stays in text' },
      { id: 'list_1', component: 'List', children: { componentId: 'row-1', path: '/rows' } },
      { id: 'row-1', component: 'Text', text: 'row' },
    ]

    expect(
      allowedSurfaceContent({
        a2ui_operations: [{ version: '1.0', updateComponents: { surfaceId: 's', components } }],
      }),
    ).toEqual({
      a2ui_operations: [
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [
              { id: 'root', component: 'Column', children: ['card_1', 'list_1'] },
              { id: 'card_1', component: 'Card', child: 'name_1' },
              { id: 'name_1', component: 'Text', text: 'card-1 stays in text' },
              { id: 'list_1', component: 'List', children: { componentId: 'row_1', path: '/rows' } },
              { id: 'row_1', component: 'Text', text: 'row' },
            ],
          },
        },
      ],
    })
  })

  it('leaves v0.9 ids alone, and a 1.0 id whose underscore spelling is taken', () => {
    const v09 = {
      a2ui_operations: [{ version: 'v0.9', updateComponents: { surfaceId: 's', components: [image, root] } }],
    }

    const clash = [
      { id: 'root', component: 'Column', children: ['a-b', 'a_b'] },
      { id: 'a-b', component: 'Text', text: '1' },
      { id: 'a_b', component: 'Text', text: '2' },
    ]

    const taken = { a2ui_operations: [{ version: '1.0', updateComponents: { surfaceId: 's', components: clash } }] }

    expect(JSON.stringify(allowedSurfaceContent(v09))).toContain('"id":"photo"')
    expect(allowedSurfaceContent(taken)).toEqual(taken)
  })

  it('blanks a component under an operation key it does not know', () => {
    const content = { a2ui_operations: [{ version: '1.0', fooOp: { components: [image] } }] }

    expect(allowedSurfaceContent(content)).toEqual({
      a2ui_operations: [{ version: '1.0', fooOp: { components: [blanked] } }],
    })
  })

  it.each([
    ['v0.9', { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } }],
    ['v0.9', { version: 'v0.9', updateComponents: { surfaceId: 's', components: [root] } }],
    ['1.0', { version: '1.0', createSurface: { surfaceId: 's', catalogId: 'c', components: [root] } }],
    ['1.0', { version: '1.0', updateDataModel: { surfaceId: 's', path: '/', value: { name: 'x' } } }],
  ])('leaves a clean %s operation as it came', (_version, operation) => {
    const content = { a2ui_operations: [operation], status: 'complete' }

    expect(allowedSurfaceContent(content)).toEqual(content)
  })

  describe('with a 1.0 host catalog', () => {
    const hostCatalog = extendBasicA2uiCatalog(
      { HostBadge: { props: a2uiProps.object({ label: a2uiProps.string() }) } },
      {
        HostBadge: () => {
          return null
        },
      },
    )

    const allowList = a2uiAllowedComponents(hostCatalog)
    const badge = { id: 'badge', component: 'HostBadge', label: 'x' }
    const blankedBadge = { id: 'badge', component: 'Text', text: '' }

    it('is a 1.0 catalog without the media components', () => {
      expect(hostCatalog.protocolVersion).toBe('1.0')
      expect(hostCatalog.id).toBe('https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json')
      expect([...hostCatalog.components.keys()]).not.toContain('Image')
    })

    it('keeps the host component in a 1.0 operation and still blanks Image', () => {
      const content = {
        a2ui_operations: [{ version: '1.0', updateComponents: { surfaceId: 's', components: [root, badge, image] } }],
      }

      expect(allowedSurfaceContent(content, allowList)).toEqual({
        a2ui_operations: [{ version: '1.0', updateComponents: { surfaceId: 's', components: [root, badge, blanked] } }],
      })
    })

    // The renderer replays a v0.9 surface through its whole v0.9 basic catalog, Image included.
    it.each([
      ['v0.9', { version: 'v0.9' }],
      ['no version (read as v0.9)', {}],
    ])('blanks Image and the host component in a %s operation', (_label, version) => {
      const content = {
        a2ui_operations: [{ ...version, updateComponents: { surfaceId: 's', components: [root, badge, image] } }],
      }

      expect(allowedSurfaceContent(content, allowList)).toEqual({
        a2ui_operations: [
          { ...version, updateComponents: { surfaceId: 's', components: [root, blankedBadge, blanked] } },
        ],
      })
    })
  })

  it('passes content without operations through untouched', () => {
    const failed = { status: 'failed', error: 'a2ui_render_failed' }

    expect(allowedSurfaceContent(failed)).toBe(failed)
  })
})
