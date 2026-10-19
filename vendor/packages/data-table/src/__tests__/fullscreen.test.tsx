import { describe, expect, it } from 'vitest'
import type { RenderResult } from 'vitest-browser-react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { TableColumnConfig, TableConfig } from '../config'
import { DataTable } from '../core/data-table'
import { DATA_TABLE_FULLSCREEN_Z_INDEX } from '../primitives/z-index'

interface FullscreenRow {
  id: string
  name: string
}

const ROWS: FullscreenRow[] = [{ id: 'r1', name: 'Alice' }]

const buildColumns = (): TableColumnConfig<FullscreenRow>[] => {
  return [
    {
      id: 'name',
      label: 'Name',
      cell: {
        kind: 'text',
        value: (row) => {
          return row.name
        },
      },
    },
  ]
}

const buildConfig = (overrides: Partial<TableConfig<FullscreenRow>> = {}): TableConfig<FullscreenRow> => {
  return {
    data: ROWS,
    getRowId: (row) => {
      return row.id
    },
    columns: buildColumns(),
    ...overrides,
  }
}

const enterFullscreen = async (screen: RenderResult) => {
  await userEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
}

describe('data table fullscreen', () => {
  it('renders no fullscreen toggle when config.fullscreen is not set', async () => {
    const screen = await render(<DataTable config={buildConfig()} />)

    await expect.element(screen.getByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument()
  })

  it('renders the toggle when config.fullscreen is set and portals the shell into document.body', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    await expect.element(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()

    await enterFullscreen(screen)

    const dialog = screen.getByRole('dialog')

    await expect.element(dialog).toBeInTheDocument()
    expect(dialog.element().parentElement).toBe(document.body)
  })

  it('exits fullscreen on Escape', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    await enterFullscreen(screen)
    await expect.element(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('exits fullscreen when the portal close button is clicked', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    await enterFullscreen(screen)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('locks body scroll while fullscreen is open and restores it once closed', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    expect(document.body.style.overflow).not.toBe('hidden')

    await enterFullscreen(screen)
    expect(document.body.style.overflow).toBe('hidden')

    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('applies the package default z-index inline when zIndexClassName is not set', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    await enterFullscreen(screen)

    const dialog = screen.getByRole('dialog').element() as HTMLElement

    expect(dialog.style.zIndex).toBe(String(DATA_TABLE_FULLSCREEN_Z_INDEX))
  })

  it('suppresses the inline z-index default when config.fullscreen.zIndexClassName is set', async () => {
    const screen = await render(<DataTable config={buildConfig({ fullscreen: { zIndexClassName: 'z-[2000]' } })} />)

    await enterFullscreen(screen)

    const dialog = screen.getByRole('dialog').element() as HTMLElement

    expect(dialog.style.zIndex).toBe('')
    expect(dialog.className).toContain('z-[2000]')
  })

  it('titles the dialog from config.fullscreen.title, defaulting to "Table"', async () => {
    const defaultScreen = await render(<DataTable config={buildConfig({ fullscreen: true })} />)

    await enterFullscreen(defaultScreen)
    await expect.element(defaultScreen.getByRole('dialog', { name: 'Table' })).toBeInTheDocument()

    const titledScreen = await render(<DataTable config={buildConfig({ fullscreen: { title: 'My rows' } })} />)

    await enterFullscreen(titledScreen)
    await expect.element(titledScreen.getByRole('dialog', { name: 'My rows' })).toBeInTheDocument()
  })

  it('drops the toggle from a custom headerActions, matching the app trade-off', async () => {
    const screen = await render(
      <DataTable config={buildConfig({ fullscreen: true, headerActions: <span>Custom actions</span> })} />,
    )

    await expect.element(screen.getByText('Custom actions')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument()
  })
})
