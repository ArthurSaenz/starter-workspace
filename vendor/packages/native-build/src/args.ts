import { parseArgs } from 'node:util'

import { CliError } from './cli-error.ts'
import { parseDomain } from './domain.ts'

export type TargetEnv = 'dev' | 'prod'

export interface CliArgs {
  env: TargetEnv
  domain: string
  version?: string
  dryRun: boolean
}

export type ParsedArgs = { help: true } | ({ help: false } & CliArgs)

export const USAGE = `Usage: wl-native-build <dev|prod> --domain <https-url> [--version <x.y.z>] [--dry-run]

Stamps the native version, builds the Capacitor app against <domain> and syncs it into ios/ and android/.
Run it from the Capacitor app directory (pnpm run does that).

  dev | prod           dev stamps N.9.(highest p + 1), prod stamps N.0.0; N is HEAD's committed major
  --domain <url>       the MFE origin the bundle loads, e.g. https://dev.example.com
  --version <x.y.z>    stamp this version instead: starts a new major, or confirms a delivered prod rebuild
  --dry-run            print the derived plan; write and run nothing except git fetch
  --help               show this help`

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

const isTargetEnv = (value: string): value is TargetEnv => {
  return value === 'dev' || value === 'prod'
}

const parseRaw = (argv: string[]) => {
  try {
    return parseArgs({
      // pnpm forwards a literal `--` in some invocations; it carries no meaning here.
      args: argv.filter((token) => {
        return token !== '--'
      }),
      allowPositionals: true,
      strict: true,
      options: {
        domain: { type: 'string' },
        version: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${USAGE}`)
  }
}

export const parseCliArgs = (argv: string[]): ParsedArgs => {
  const { values, positionals } = parseRaw(argv)

  if (values.help) return { help: true }

  const [env, ...extra] = positionals

  if (extra.length > 0) throw new CliError(`unexpected argument: ${extra.join(' ')}\n\n${USAGE}`)

  if (!env || !isTargetEnv(env))
    throw new CliError(`the environment must be dev or prod, got: ${env ?? 'nothing'}\n\n${USAGE}`)

  if (!values.domain) throw new CliError(`--domain is required\n\n${USAGE}`)

  if (values.version !== undefined && !VERSION_PATTERN.test(values.version)) {
    throw new CliError(`--version must be x.y.z, got: ${values.version}`)
  }

  return {
    help: false,
    env,
    domain: parseDomain(values.domain),
    ...(values.version === undefined ? {} : { version: values.version }),
    dryRun: values['dry-run'],
  }
}
