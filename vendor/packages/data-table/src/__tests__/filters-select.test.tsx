import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SelectFilterConfig } from '../config/filter-config'
import { SelectFilter } from '../filters/select-filter'

const OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const buildConfig = (overrides: Partial<SelectFilterConfig> = {}): SelectFilterConfig => {
  return {
    kind: 'select',
    id: 'status',
    value: '',
    onChange: vi.fn(),
    options: OPTIONS,
    ...overrides,
  }
}

describe('selectFilter', () => {
  it('renders the controlled value', async () => {
    const config = buildConfig({ value: 'active' })

    const screen = await render(<SelectFilter config={config} />)

    await expect.element(screen.getByRole('combobox')).toHaveTextContent('Active')
  })

  it('calls onChange with the selected option value', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange })

    const screen = await render(<SelectFilter config={config} />)

    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'Inactive' }).click()

    expect(onChange).toHaveBeenCalledWith('inactive')
  })

  it('keeps no committed state of its own — the trigger still reflects the value prop', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, value: 'active' })

    const screen = await render(<SelectFilter config={config} />)

    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'Inactive' }).click()

    expect(onChange).toHaveBeenCalledWith('inactive')
    await expect.element(screen.getByRole('combobox')).toHaveTextContent('Active')
  })

  it('shows a clear affordance and calls onChange with an empty string when allowClear', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange, value: 'active', allowClear: true })

    const screen = await render(<SelectFilter config={config} />)

    await screen.getByRole('button', { name: 'Clear' }).click()

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('does not show a clear affordance without a value', async () => {
    const config = buildConfig({ allowClear: true, value: '' })

    const screen = await render(<SelectFilter config={config} />)

    await expect.element(screen.getByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
