import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SearchFilterConfig } from '../config/filter-config'
import { SearchFilter } from '../filters/search-filter'

const buildConfig = (overrides: Partial<SearchFilterConfig> = {}): SearchFilterConfig => {
  return {
    kind: 'search',
    id: 'free-search',
    value: '',
    onChange: vi.fn(),
    ...overrides,
  }
}

describe('searchFilter', () => {
  it('renders the controlled value', async () => {
    const config = buildConfig({ value: 'hawaii' })

    const screen = await render(<SearchFilter config={config} />)

    await expect.element(screen.getByRole('textbox')).toHaveValue('hawaii')
  })

  it('fires onChange with the typed text when no debounceMs is set', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange })

    const screen = await render(<SearchFilter config={config} />)

    await screen.getByRole('textbox').fill('maui')

    expect(onChange).toHaveBeenCalledWith('maui')
  })

  it('writes config.name to the input and names it by its placeholder', async () => {
    const config = buildConfig({ name: 'freeSearch', placeholder: 'Search deals' })

    const screen = await render(<SearchFilter config={config} />)

    await expect.element(screen.getByRole('textbox')).toHaveAttribute('name', 'freeSearch')
    await expect.element(screen.getByRole('textbox')).toHaveAccessibleName('Search deals')
  })

  it('prefers ariaLabel over the placeholder for the accessible name', async () => {
    const config = buildConfig({ placeholder: 'Search deals', ariaLabel: 'Search flight deals' })

    const screen = await render(<SearchFilter config={config} />)

    await expect.element(screen.getByRole('textbox')).toHaveAccessibleName('Search flight deals')
  })

  it('debounces onChange, firing only after the delay has elapsed', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, debounceMs: 30 })

    const screen = await render(<SearchFilter config={config} />)

    await screen.getByRole('textbox').fill('kauai')

    expect(onChange).not.toHaveBeenCalled()

    await new Promise((resolve) => {
      setTimeout(resolve, 90)
    })

    expect(onChange).toHaveBeenCalledWith('kauai')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps no committed state of its own — it re-syncs to a new controlled value', async () => {
    const ControlledHarness = () => {
      const [value, setValue] = useState('initial')

      return (
        <>
          <SearchFilter config={buildConfig({ value, onChange: setValue })} />
          <button
            type="button"
            onClick={() => {
              setValue('reset')
            }}
          >
            reset
          </button>
        </>
      )
    }

    const screen = await render(<ControlledHarness />)

    await screen.getByRole('textbox').fill('typed')
    await expect.element(screen.getByRole('textbox')).toHaveValue('typed')

    await screen.getByRole('button', { name: 'reset' }).click()
    await expect.element(screen.getByRole('textbox')).toHaveValue('reset')
  })
})
