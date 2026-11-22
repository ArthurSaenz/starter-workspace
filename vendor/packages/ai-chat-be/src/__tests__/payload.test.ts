import { describe, expect, it } from 'vitest'

import { MAX_TOOL_RESULT_CHARS, capPayload } from '../tools/payload.js'

describe('capPayload', () => {
  const wideItem = { id: 'x'.repeat(200), note: 'y'.repeat(200) }

  it('returns a payload that already fits, untouched', () => {
    const value = { total: 2, items: [{ id: 'a' }, { id: 'b' }] }

    expect(capPayload(value)).toBe(value)
  })

  // The hazard: `total` is the producer's MATCH COUNT, which is larger than the page and
  // larger again than what survives the cap. Overwriting it made `hotels_search` tell the
  // traveller the catalogue holds as many hotels as fitted into 8 KB.
  it('truncates on an item boundary and never overwrites the producer total', () => {
    const items = Array.from({ length: 200 }, (_unused, index) => {
      return { ...wideItem, index }
    })

    const capped = capPayload({ total: 140, items }) as {
      items: unknown[]
      truncated: boolean
      cappedShown: number
      cappedFrom: number
      total: number
    }

    expect(capped.total).toBe(140)
    expect(capped.truncated).toBe(true)
    expect(capped.cappedShown).toBe(capped.items.length)
    expect(capped.cappedFrom).toBe(200)
    expect(capped.items.length).toBeLessThan(200)
    // The whole point: what comes out still parses, and every surviving item is whole.
    expect(JSON.parse(JSON.stringify(capped))).toEqual(capped)
    expect(capped.items[0]).toEqual(items[0])
    expect(capped.items.at(-1)).toEqual(items[capped.cappedShown - 1])
  })

  it('keeps the capped payload inside the character budget', () => {
    const items = Array.from({ length: 500 }, (_unused, index) => {
      return { ...wideItem, index }
    })

    expect(JSON.stringify(capPayload({ items })).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS)
  })

  it('honours a caller-supplied cap', () => {
    const items = Array.from({ length: 50 }, (_unused, index) => {
      return { index }
    })

    const capped = capPayload({ items }, 120) as { cappedShown: number }

    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(120)
    expect(capped.cappedShown).toBeGreaterThan(0)
  })

  it('refuses rather than overflow when even an empty list does not fit', () => {
    const capped = capPayload({ note: 'z'.repeat(500), items: [{ a: 1 }] }, 100) as {
      truncated: boolean
      omitted: string
    }

    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(200)
    expect(capped.truncated).toBe(true)
    expect(capped.omitted).toContain('narrow the call')
  })

  // An array this function does not recognise is NOT shortened: cutting an unknown list can
  // drop the very field that made the result useful, so the payload is refused instead.
  it('refuses an oversized payload whose only array is not a known item list', () => {
    const mysteryRows = Array.from({ length: 400 }, () => {
      return 'x'.repeat(40)
    })

    const capped = capPayload({ mysteryRows }) as {
      truncated: boolean
      omitted: string
    }

    expect(capped.truncated).toBe(true)
    expect(capped.omitted).toContain('narrow the call')
  })

  it('shortens the item list rather than the provenance a source entry carries', () => {
    const sources = Array.from({ length: 80 }, (_unused, index) => {
      return { url: `https://example.com/${String(index)}`, factIds: ['a'.repeat(120)] }
    })

    const capped = capPayload({ items: sources, note: 'z'.repeat(50) }) as { items: Array<{ factIds: string[] }> }

    expect(capped.items[0]?.factIds).toEqual(sources[0]?.factIds)
  })

  it('reports an oversized payload with no item list rather than emitting broken JSON', () => {
    const capped = capPayload({ blob: 'x'.repeat(20_000) }) as { truncated: boolean; omitted: string }

    expect(capped.truncated).toBe(true)
    expect(capped.omitted).toContain('narrow the call')
  })
})
