import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { NumberRangeFilterConfig, NumberRangeValue } from '../config/filter-config'
import { NumberRangeFilter } from '../filters/number-range-filter'

interface ControlledRangeProps {
  onChange: (value: NumberRangeValue) => void
}

const ControlledRange = (props: ControlledRangeProps) => {
  const { onChange } = props

  const [value, setValue] = useState<NumberRangeValue>({ min: 100, max: 500 })

  return (
    <>
      <NumberRangeFilter
        config={buildConfig({
          value,
          onChange: (next) => {
            setValue(next)
            onChange(next)
          },
        })}
      />
      <button
        type="button"
        onMouseDown={(event) => {
          // Keeps focus in the input, so the reset is what clears the draft rather than a blur.
          event.preventDefault()
        }}
        onClick={() => {
          setValue({ min: 0, max: 1000 })
        }}
      >
        reset
      </button>
    </>
  )
}

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

  it('commits nothing when an input is emptied', async () => {
    const onChange = vi.fn()

    const screen = await render(<NumberRangeFilter config={buildConfig({ onChange })} />)

    await screen.getByRole('spinbutton', { name: 'Maximum' }).fill('')
    await screen.getByRole('spinbutton', { name: 'Minimum' }).fill('')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets a multi-digit maximum be typed whose leading digits fall below the minimum', async () => {
    const onChange = vi.fn()
    const screen = await render(<ControlledRange onChange={onChange} />)
    const max = screen.getByRole('spinbutton', { name: 'Maximum' })

    await max.fill('')
    await userEvent.type(max, '200')

    await expect.element(max).toHaveValue(200)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({ min: 100, max: 200 })
  })

  it('commits a crossing entry on blur, ordered and clamped', async () => {
    const onChange = vi.fn()
    const screen = await render(<ControlledRange onChange={onChange} />)
    const max = screen.getByRole('spinbutton', { name: 'Maximum' })

    await max.fill('50')
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{Tab}')

    expect(onChange).toHaveBeenLastCalledWith({ min: 50, max: 100 })
    await expect.element(screen.getByRole('spinbutton', { name: 'Minimum' })).toHaveValue(50)
    await expect.element(max).toHaveValue(100)
  })

  it('drops a held draft once the value changes from outside', async () => {
    const screen = await render(<ControlledRange onChange={vi.fn()} />)
    const max = screen.getByRole('spinbutton', { name: 'Maximum' })

    await max.fill('5')
    await screen.getByRole('button', { name: 'reset' }).click()

    await expect.element(max).toHaveValue(1000)
  })
})
