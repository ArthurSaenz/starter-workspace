import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { MultiselectFilterConfig } from '../config/filter-config'
import { MultiselectFilter } from '../filters/multiselect-filter'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]

const buildConfig = (overrides: Partial<MultiselectFilterConfig> = {}): MultiselectFilterConfig => {
  return {
    kind: 'multiselect',
    id: 'tags',
    values: [],
    onChange: vi.fn(),
    options: OPTIONS,
    ...overrides,
  }
}

describe('multiselectFilter', () => {
  it('renders chips for the controlled values', async () => {
    const config = buildConfig({ values: ['a'] })

    const screen = await render(<MultiselectFilter config={config} />)

    await expect.element(screen.getByRole('button', { name: /remove alpha/i })).toBeVisible()
  })

  it('calls onChange with the toggled values on selection', async () => {
    const onChange = vi.fn()
    const config = buildConfig({ onChange })

    const screen = await render(<MultiselectFilter config={config} />)

    await screen.getByRole('combobox').click()
    await screen.getByText('Alpha').click()

    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('fuzzy-matches option order via match-sorter by default', async () => {
    const screen = await render(<MultiselectFilter config={buildConfig()} />)

    // 'ah' is a subsequence of "Alpha" (A...h) but not a contiguous substring, so this
    // only passes under match-sorter's fuzzy ranking, not the combobox's plain substring filter.
    await screen.getByRole('combobox').fill('ah')

    await expect.element(screen.getByText('Alpha')).toBeVisible()
  })

  it('falls back to substring matching when searchable is false', async () => {
    const screen = await render(<MultiselectFilter config={buildConfig({ searchable: false })} />)

    await screen.getByRole('combobox').fill('ah')

    await expect.element(screen.getByText('Alpha')).not.toBeInTheDocument()
  })

  it('surfaces a createValidator error and blocks the create option', async () => {
    const createValidator = vi.fn().mockReturnValue('too short')

    const screen = await render(<MultiselectFilter config={buildConfig({ allowCreate: true, createValidator })} />)

    await screen.getByRole('combobox').fill('z')

    await expect.element(screen.getByText('too short')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Add "z"' })).not.toBeInTheDocument()
  })
})
