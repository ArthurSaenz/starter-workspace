import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { ClearAllFilterConfig } from '../config/filter-config'
import { ClearAllFilter } from '../filters/clear-all-filter'

const buildConfig = (overrides: Partial<ClearAllFilterConfig> = {}): ClearAllFilterConfig => {
  return {
    kind: 'clear-all',
    id: 'clear',
    onClear: vi.fn(),
    ...overrides,
  }
}

describe('clearAllFilter', () => {
  it('renders the default label', async () => {
    const screen = await render(<ClearAllFilter config={buildConfig()} />)

    await expect.element(screen.getByRole('button', { name: 'Clear' })).toBeVisible()
  })

  it('renders a custom label', async () => {
    const screen = await render(<ClearAllFilter config={buildConfig({ label: 'Reset filters' })} />)

    await expect.element(screen.getByRole('button', { name: 'Reset filters' })).toBeVisible()
  })

  it('calls onClear on every click and keeps no state of its own', async () => {
    const onClear = vi.fn()
    const screen = await render(<ClearAllFilter config={buildConfig({ onClear })} />)

    await screen.getByRole('button', { name: 'Clear' }).click()
    await screen.getByRole('button', { name: 'Clear' }).click()

    expect(onClear).toHaveBeenCalledTimes(2)
  })
})
