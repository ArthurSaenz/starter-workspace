import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { NumberRangeFilterConfig } from '../config/filter-config'
import { NumberRangeFilter } from '../filters/number-range-filter'

const buildConfig = (overrides: Partial<NumberRangeFilterConfig> = {}): NumberRangeFilterConfig => {
  return {
    kind: 'number-range',
    id: 'price',
    value: { min: 100, max: 500 },
    onChange: vi.fn(),
    bounds: { min: 0, max: 1000 },
    ...overrides,
  }
}

describe('numberRangeFilter', () => {
  it('renders the controlled min/max values', async () => {
    const screen = await render(<NumberRangeFilter config={buildConfig()} />)

    await expect.element(screen.getByRole('spinbutton', { name: 'Minimum' })).toHaveValue(100)
    await expect.element(screen.getByRole('spinbutton', { name: 'Maximum' })).toHaveValue(500)
  })

  it('calls onChange with the updated range when the min input changes', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange })

    const screen = await render(<NumberRangeFilter config={config} />)

    await screen.getByRole('spinbutton', { name: 'Minimum' }).fill('200')

    expect(onChange).toHaveBeenCalledWith({ min: 200, max: 500 })
  })

  it('calls onChange with the updated range when the max input changes', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange })

    const screen = await render(<NumberRangeFilter config={config} />)

    await screen.getByRole('spinbutton', { name: 'Maximum' }).fill('400')

    expect(onChange).toHaveBeenCalledWith({ min: 100, max: 400 })
  })

  it('commits the slider position once a handle is moved', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, step: 10 })

    const screen = await render(<NumberRangeFilter config={config} />)

    await screen.getByRole('slider').first().click()
    await userEvent.keyboard('{ArrowRight}')

    await expect
      .poll(() => {
        return onChange.mock.calls.at(-1)?.[0]
      })
      .toEqual({ min: 110, max: 500 })
  })

  it('clamps a min entry above bounds.max down to bounds.max', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, bounds: { min: 0, max: 500 } })

    const screen = await render(<NumberRangeFilter config={config} />)

    await screen.getByRole('spinbutton', { name: 'Minimum' }).fill('9999')

    expect(onChange).toHaveBeenCalledWith({ min: 500, max: 500 })
  })
})
