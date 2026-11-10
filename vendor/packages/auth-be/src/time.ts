/** Stores hand timestamps back as a `Date` or as the driver's string; NaN when unparseable. */
export const toMs = (value: Date | string): number => {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}
