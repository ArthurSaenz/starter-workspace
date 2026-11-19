import { CliError } from './cli-error.ts'

const toOrigin = (value: string, label: string): string => {
  try {
    return new URL(value).origin
  } catch {
    throw new CliError(`${label} is not a URL: ${value}`)
  }
}

export const parseDomain = (value: string): string => {
  const url = toOrigin(value, '--domain')

  if (!url.startsWith('https://')) throw new CliError(`--domain must be an https URL: ${value}`)

  return url
}

/** The origin the build uses; `--domain` wins, and a differing `VITE_MOBILE_DOMAIN_URL` is refused, not overridden. */
export const resolveDomain = (domain: string, envValue: string | undefined): string => {
  const origin = parseDomain(domain)

  if (envValue && toOrigin(envValue, 'VITE_MOBILE_DOMAIN_URL') !== origin) {
    throw new CliError(
      `VITE_MOBILE_DOMAIN_URL=${envValue} does not match --domain ${origin}: unset it or pass the matching --domain`,
    )
  }

  return origin
}
