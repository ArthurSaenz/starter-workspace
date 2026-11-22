import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}

// A tool name is camelCase, dot- or underscore-separated (`lookupLoyaltyBalance`,
// `loyalty_facts`) — never a phrase a traveller should read verbatim.
export const humaniseToolName = (name: string): string => {
  return name
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
}
