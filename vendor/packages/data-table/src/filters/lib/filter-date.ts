import { isValid, parse } from 'date-fns'

/** Filter values are stored strings from the consumer (URL, saved view), so one may not parse. */
export const parseFilterDate = (value: string | undefined, dateFormat: string): Date | undefined => {
  if (!value) {
    return undefined
  }

  const parsed = parse(value, dateFormat, new Date())

  return isValid(parsed) ? parsed : undefined
}
