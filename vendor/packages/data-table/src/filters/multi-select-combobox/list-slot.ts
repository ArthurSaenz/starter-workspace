export const MULTI_SELECT_COMBOBOX_LIST_SLOT = 'multi-select-combobox-list'

export const isMultiSelectComboboxListEvent = (event: { target: EventTarget | null }): boolean => {
  return (
    event.target instanceof Element && event.target.closest(`[data-slot="${MULTI_SELECT_COMBOBOX_LIST_SLOT}"]`) !== null
  )
}
