import { describe, expect, it } from 'vitest'

import { MULTI_SELECT_COMBOBOX_LIST_SLOT, isMultiSelectComboboxListEvent } from '../filters/multi-select-combobox'

describe('isMultiSelectComboboxListEvent', () => {
  it('returns true when the target is inside the portaled list', () => {
    const list = document.createElement('ul')

    list.setAttribute('data-slot', MULTI_SELECT_COMBOBOX_LIST_SLOT)

    const button = document.createElement('button')

    list.appendChild(button)
    document.body.appendChild(list)

    expect(isMultiSelectComboboxListEvent({ target: button })).toBe(true)

    list.remove()
  })

  it('returns false for clicks outside the portaled list', () => {
    const button = document.createElement('button')

    document.body.appendChild(button)

    expect(isMultiSelectComboboxListEvent({ target: button })).toBe(false)
    expect(isMultiSelectComboboxListEvent({ target: null })).toBe(false)

    button.remove()
  })
})
