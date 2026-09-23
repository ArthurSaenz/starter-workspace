import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

// Same machine-local config `copy-shared-repos-data.mjs` reads, for the same reason: one place says
// where the consumer repos are checked out.
const VENDOR_CONFIG_PATH = join(process.env.HOME, '.infra-kit', 'vendor.json')

// The `extends` value that defines Set G: every backend, CLI included, builds with `tsc -b` off the
// one service config. See .omc/plans/backend-import-extensions.md §1.
const SET_G_EXTENDS = ['@wl/ts-config/tsconfig.service.json']

const WALK_SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.turbo'])

// tsc resolves paths relative to the tsconfig's own directory. Every generated config here lives in
// a temp dir, so each path-valued option inherited from the package must be made absolute first.
const PATH_OPTIONS = ['rootDir', 'baseUrl', 'declarationDir']

const expandHome = (path) => (path.startsWith('~/') ? join(process.env.HOME, path.slice(2)) : path)

const readWorkspaceDir = () => {
  if (!existsSync(VENDOR_CONFIG_PATH)) return join(process.env.HOME, 'projects')

  const { workspaceDir } = JSON.parse(readFileSync(VENDOR_CONFIG_PATH, 'utf8'))

  return expandHome(workspaceDir ?? '~/projects')
}

export const resolveRepoRoot = (name) => {
  const repoRoot = join(readWorkspaceDir(), name)

  if (!existsSync(repoRoot)) throw new Error(`No such repo: ${repoRoot}`)

  return repoRoot
}

// tsconfig files are JSONC: the vendor config is mostly comments, and package configs copy that
// style. A char scanner rather than a regex because `//` also occurs inside string values.
const stripJsonComments = (text) => {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (inLine) {
      if (char === '\n') {
        inLine = false
        out += char
      }
      continue
    }

    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }

    if (inString) {
      out += char
      if (char === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      continue
    }

    if (char === '/' && next === '/') {
      inLine = true
      i++
      continue
    }

    if (char === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }

    out += char
  }

  return out.replace(/,(\s*[}\]])/g, '$1')
}

export const readTsconfig = (path) => JSON.parse(stripJsonComments(readFileSync(path, 'utf8')))

const walkTsconfigs = (root, acc = []) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue
      walkTsconfigs(join(root, entry.name), acc)
      continue
    }

    if (/^tsconfig.*\.json$/.test(entry.name)) acc.push(join(root, entry.name))
  }

  return acc
}

const nearestPackageDir = (repoRoot, filePath) => {
  let dir = dirname(filePath)

  while (dir.startsWith(repoRoot)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }

  return null
}

const extendsTarget = (tsconfig) => {
  const raw = tsconfig.extends
  const candidates = Array.isArray(raw) ? raw : [raw]

  return candidates.find((value) => SET_G_EXTENDS.includes(value)) ?? null
}

// Set G, derived. Requirement 1 of the plan: never a hand-maintained list. A package whose matching
// tsconfig is not `tsconfig.json` (a `tsconfig.internal.json` fork) is handled through that file,
// since it is the one carrying the vendor extends.
export const deriveSetG = (repoRoot) => {
  const byPackage = new Map()

  for (const path of walkTsconfigs(repoRoot)) {
    const text = readFileSync(path, 'utf8')
    if (!SET_G_EXTENDS.some((value) => text.includes(`"${value}"`))) continue

    const packageDir = nearestPackageDir(repoRoot, path)
    if (!packageDir) continue

    const dir = relative(repoRoot, packageDir)
    const existing = byPackage.get(dir)

    if (!existing) {
      byPackage.set(dir, { dir, packageDir, tsconfigPaths: [path] })
      continue
    }

    existing.tsconfigPaths.push(path)
  }

  const setG = [...byPackage.values()]
    .map((pkg) => {
      const sorted = [...pkg.tsconfigPaths].sort()
      const preferred = sorted.find((path) => path.endsWith('/tsconfig.json')) ?? sorted[0]

      return { ...pkg, tsconfigPaths: sorted, tsconfigPath: preferred }
    })
    .sort((a, b) => a.dir.localeCompare(b.dir))

  if (setG.length === 0) throw new Error(`Derived Set G is empty for ${repoRoot} — check the vendor ts-config sync.`)

  return setG
}

// A package with two Set G tsconfigs gets one of them silently ignored, so say which. Reported on
// stderr because it is provenance, not a result.
export const noteForkedTsconfigs = (repoRoot, setG, verb) => {
  for (const pkg of setG.filter((p) => p.tsconfigPaths.length > 1)) {
    const others = pkg.tsconfigPaths.filter((path) => path !== pkg.tsconfigPath)
    process.stderr.write(
      `note: ${pkg.dir} has ${pkg.tsconfigPaths.length} Set G tsconfigs; ${verb} ${relative(repoRoot, pkg.tsconfigPath)} ` +
        `(ignoring ${others.map((path) => relative(repoRoot, path)).join(', ')})\n`,
    )
  }
}

export const selectPackages = (setG, requested) => {
  if (requested.length === 0) return setG

  const known = new Set(setG.map((pkg) => pkg.dir))
  const unknown = requested.filter((dir) => !known.has(dir))

  if (unknown.length) {
    throw new Error(`Not in Set G: ${unknown.join(', ')}\nSet G is:\n  ${setG.map((p) => p.dir).join('\n  ')}`)
  }

  return setG.filter((pkg) => requested.includes(pkg.dir))
}

const absolutizeGlobs = (globs, packageDir) => globs.map((glob) => (isAbsolute(glob) ? glob : join(packageDir, glob)))

// The part of a generated tsconfig that is the same whatever the caller is measuring: the package's
// own options with every path made absolute, minus the emit destination, which each caller chooses.
// Plan requirement 4 — a config outside the package resolves nothing relatively.
export const buildBaseTsconfig = (repoRoot, pkg) => {
  const tsconfig = readTsconfig(pkg.tsconfigPath)
  const target = extendsTarget(tsconfig)

  if (!target) {
    throw new Error(`${pkg.tsconfigPath} matched Set G by text but its "extends" does not name a vendor config`)
  }

  const vendorConfig = join(repoRoot, 'vendor', 'configs', 'ts-config', target.split('/').pop())

  if (!existsSync(vendorConfig)) {
    throw new Error(`Missing ${vendorConfig} — has this repo been synced from starter-workspace?`)
  }

  const { outDir, tsBuildInfoFile, ...inherited } = tsconfig.compilerOptions ?? {}

  for (const option of PATH_OPTIONS) {
    if (typeof inherited[option] === 'string') inherited[option] = join(pkg.packageDir, inherited[option])
  }

  if (Array.isArray(inherited.rootDirs)) inherited.rootDirs = absolutizeGlobs(inherited.rootDirs, pkg.packageDir)

  // `paths` targets resolve against `baseUrl`, or the tsconfig's directory when it is unset — the
  // temp dir here. Left relative, every alias would point at nothing and surface as phantom TS2307s.
  if (inherited.paths && typeof inherited.paths === 'object') {
    inherited.paths = Object.fromEntries(
      Object.entries(inherited.paths).map(([alias, targets]) => [alias, absolutizeGlobs(targets, pkg.packageDir)]),
    )
  }

  return {
    extends: vendorConfig,
    compilerOptions: {
      ...inherited,
      typeRoots: [join(repoRoot, 'node_modules', '@types')],
      rootDir: inherited.rootDir ?? join(pkg.packageDir, 'src'),
    },
    include: absolutizeGlobs(tsconfig.include ?? ['src'], pkg.packageDir),
    exclude: absolutizeGlobs(tsconfig.exclude ?? ['node_modules', 'dist'], pkg.packageDir),
  }
}

// Plan requirement 3: the repo's own compiler, never this workspace's. `tsc` exits non-zero on any
// diagnostic, so a throw is the normal path and the status says nothing the output does not.
export const runTsc = (repoRoot, configPath) => {
  const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc')

  if (!existsSync(tsc)) throw new Error(`Missing ${tsc} — run \`pnpm install\` in the repo first.`)

  try {
    return execFileSync(tsc, ['-p', configPath, '--pretty', 'false'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    if (error.stdout == null && error.stderr == null) throw error
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

const ERROR_LINE = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const GLOBAL_ERROR_LINE = /^error (TS\d+): (.*)$/

export const parseErrors = (repoRoot, stdout) => {
  const errors = []

  for (const line of stdout.split('\n')) {
    const match = ERROR_LINE.exec(line.trim())

    if (match) {
      const [, file, row, col, code, message] = match
      // A diagnostic can name the generated config in a temp dir, which is outside the repo; a
      // relative path there is an unreadable chain of `..`, so keep it absolute.
      const rel = isAbsolute(file) ? relative(repoRoot, file) : file
      const display = rel.startsWith('..') ? file : rel

      errors.push({ file: display, line: Number(row), column: Number(col), code, message })
      continue
    }

    const global = GLOBAL_ERROR_LINE.exec(line.trim())
    if (global) errors.push({ file: '(config)', line: 0, column: 0, code: global[1], message: global[2] })
  }

  return errors
}

export const mapWithProgress = (packages, fn) =>
  packages.map((pkg, index) => {
    process.stderr.write(`[${index + 1}/${packages.length}] ${pkg.dir}\n`)
    return fn(pkg)
  })

export const printTable = (header, rows) => {
  const widths = header.map((text, i) => Math.max(text.length, ...rows.map((row) => row[i].length)))
  const line = (cells) =>
    cells.map((text, i) => (i === 0 ? text.padEnd(widths[i]) : text.padStart(widths[i]))).join('  ')

  console.log(line(header))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(line(row))
}

export const runMain = (main) => {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`💥 ${error.message}`)
    process.exitCode = 1
  }
}
