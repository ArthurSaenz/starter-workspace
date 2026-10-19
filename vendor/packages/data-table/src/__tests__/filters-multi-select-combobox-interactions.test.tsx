import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

import type { MultiSelectComboboxProps } from '../filters/multi-select-combobox'
import { MultiSelectCombobox } from '../filters/multi-select-combobox'

type HarnessProps = Omit<MultiSelectComboboxProps, 'value' | 'onChange' | 'options'> & {
  initialValue?: string[]
  options?: MultiSelectComboboxProps['options']
  onChange?: (next: string[]) => void
}

// Owns `value` like a real form field, so chips and the resync path see each committed selection.
const Harness = (props: HarnessProps) => {
  const { initialValue = [], options = OPTIONS, onChange, ...rest } = props

  const [value, setValue] = useState(initialValue)

  return (
    <div>
      <MultiSelectCombobox
        {...rest}
        value={value}
        options={options}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue(['c'])
        }}
      >
        external reset
      </button>
      <button type="button">outside</button>
    </div>
  )
}

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

describe('multiSelectCombobox — keyboard', () => {
  it('closes the list on Escape', async () => {
    const screen = await render(<Harness />)

    await screen.getByRole('combobox').click()
    await expect.element(screen.getByRole('listbox')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it('removes the last chip on Backspace with an empty query', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness initialValue={['a', 'b']} onChange={onChange} />)

    await screen.getByRole('combobox').click()
    await userEvent.keyboard('{Backspace}')

    expect(onChange).toHaveBeenLastCalledWith(['a'])
    await expect.element(screen.getByRole('button', { name: 'Remove Beta' })).not.toBeInTheDocument()
  })

  it('leaves the chips alone on Backspace while a query is typed', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness initialValue={['a']} onChange={onChange} />)

    await screen.getByRole('combobox').fill('Be')
    await userEvent.keyboard('{Backspace}')

    expect(onChange).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('combobox')).toHaveValue('B')
  })

  it('toggles the first match on Enter, clears the query and keeps the list open', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)

    await screen.getByRole('combobox').fill('gam')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith(['c'])
    await expect.element(screen.getByRole('combobox')).toHaveValue('')
    await expect.element(screen.getByRole('listbox')).toBeVisible()
  })

  it('closes the list after an Enter pick when closeOnSelect is set', async () => {
    const screen = await render(<Harness closeOnSelect />)

    await screen.getByRole('combobox').fill('alp')
    await userEvent.keyboard('{Enter}')

    await expect.element(screen.getByRole('button', { name: 'Remove Alpha' })).toBeVisible()
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  })

  it('creates the query on Enter when nothing matches and allowCreate is set', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness allowCreate onChange={onChange} />)

    await screen.getByRole('combobox').fill('  Zeta  ')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith(['Zeta'])
    await expect.element(screen.getByRole('button', { name: 'Remove Zeta' })).toBeVisible()
  })

  it('ignores Enter when nothing matches and creation is off', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)

    await screen.getByRole('combobox').fill('zzz')
    await userEvent.keyboard('{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('multiSelectCombobox — list actions', () => {
  it('selects every option, then deselects them all, from the Select all row', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness showSelectAll onChange={onChange} />)

    await screen.getByRole('combobox').click()
    await screen.getByRole('button', { name: 'Select all' }).click()

    expect(onChange).toHaveBeenLastCalledWith(['a', 'b', 'c'])
    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()

    await screen.getByRole('combobox').click()
    await screen.getByRole('button', { name: 'Deselect all' }).click()

    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('hides the Select all row while a query is typed', async () => {
    const screen = await render(<Harness showSelectAll />)

    await screen.getByRole('combobox').fill('a')

    await expect.element(screen.getByRole('listbox')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Select all' })).not.toBeInTheDocument()
  })

  it('adds the query from the create row', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness allowCreate onChange={onChange} />)

    await screen.getByRole('combobox').fill('Delta')
    await screen.getByRole('button', { name: 'Add "Delta"' }).click()

    expect(onChange).toHaveBeenLastCalledWith(['Delta'])
    await expect.element(screen.getByRole('combobox')).toHaveValue('')
  })

  it('offers no create row for a value that is already an option', async () => {
    const screen = await render(<Harness allowCreate />)

    await screen.getByRole('combobox').fill('a')

    await expect.element(screen.getByRole('button', { name: 'Add "a"' })).not.toBeInTheDocument()
  })

  it('removes a value through its chip', async () => {
    const onChange = vi.fn()
    const screen = await render(<Harness initialValue={['a', 'b']} onChange={onChange} />)

    await screen.getByRole('button', { name: 'Remove Alpha' }).click()

    expect(onChange).toHaveBeenLastCalledWith(['b'])
  })
})

describe('multiSelectCombobox — focus and resync', () => {
  it('closes the list when focus leaves the control', async () => {
    const screen = await render(<Harness />)

    await screen.getByRole('combobox').click()
    await expect.element(screen.getByRole('listbox')).toBeVisible()

    await screen.getByRole('button', { name: 'outside' }).click()

    await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the list and clears the query when the value changes from outside', async () => {
    const onQueryChange = vi.fn()
    const screen = await render(<Harness onQueryChange={onQueryChange} />)

    await screen.getByRole('combobox').fill('Al')
    expect(onQueryChange).toHaveBeenLastCalledWith('Al')

    // The resync runs during render, so the parent's query reset can only arrive from the post-commit effect.
    await screen.getByRole('button', { name: 'external reset' }).click()

    await expect.element(screen.getByRole('combobox')).toHaveValue('')
    await expect.element(screen.getByRole('button', { name: 'Remove Gamma' })).toBeVisible()
    expect(onQueryChange).toHaveBeenLastCalledWith('')
  })

  it('disables the input and hides chip removal when disabled', async () => {
    const screen = await render(<Harness disabled initialValue={['a']} />)

    await expect.element(screen.getByText('Alpha')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Remove Alpha' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('combobox')).toBeDisabled()
  })
})
