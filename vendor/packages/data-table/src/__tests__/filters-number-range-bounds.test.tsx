import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { NumberRangeValue } from '../config/filter-config'
import { NumberRangeFilter } from '../filters/number-range-filter'

interface ControlledRangeProps {
  onChange: (value: NumberRangeValue) => void
}

const ControlledRange = (props: ControlledRangeProps) => {
  const { onChange } = props

  const [value, setValue] = useState<NumberRangeValue>({ min: 100, max: 500 })

  return (
    <NumberRangeFilter
      config={{
        kind: 'number-range',
        id: 'price',
        value,
        bounds: { min: 100, max: 1000 },
        onChange: (next) => {
          setValue(next)
          onChange(next)
        },
      }}
    />
  )
}

describe('numberRangeFilter — bounds that do not start at zero', () => {
  it('lets a multi-digit minimum be typed whose leading digits fall below bounds.min', async () => {
    const onChange = vi.fn()
    const screen = await render(<ControlledRange onChange={onChange} />)
    const min = screen.getByRole('spinbutton', { name: 'Minimum' })

    await min.fill('')
    await userEvent.type(min, '250')

    await expect.element(min).toHaveValue(250)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ min: 250, max: 500 })
  })

  it('clamps an entry left below bounds.min once the field loses focus', async () => {
    const onChange = vi.fn()
    const screen = await render(<ControlledRange onChange={onChange} />)
    const max = screen.getByRole('spinbutton', { name: 'Maximum' })

    await max.fill('20')
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{Tab}')

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ min: 100, max: 100 })
    await expect.element(max).toHaveValue(100)
  })
})
