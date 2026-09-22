import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildBaseTsconfig,
  deriveSetG,
  noteForkedTsconfigs,
  parseErrors,
  resolveRepoRoot,
  runTsc,
  selectPackages,
} from './lib/set-g.mjs'

// Printed first and unconditionally, so a zero reads as measured rather than absent.
const ALWAYS_CODES = ['TS2835', 'TS1543', 'TS2308', 'TS7006', 'TS2339']

const buildProbeTsconfig = (repoRoot, pkg) => {
  const base = buildBaseTsconfig(repoRoot, pkg)

  return {
    ...base,
    compilerOptions: {
      ...base.compilerOptions,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      composite: false,
      incremental: false,
      declaration: false,
      declarationMap: false,
    },
  }
}

const probePackage = (repoRoot, tempRoot, pkg) => {
  const probePath = join(tempRoot, `${pkg.dir.replace(/\//g, '__')}.tsconfig.json`)

  writeFileSync(probePath, `${JSON.stringify(buildProbeTsconfig(repoRoot, pkg), null, 2)}\n`)

  const errors = parseErrors(repoRoot, runTsc(repoRoot, probePath))
  const byCode = {}

  for (const { code } of errors) byCode[code] = (byCode[code] ?? 0) + 1

  return { dir: pkg.dir, total: errors.length, byCode, errors }
}

const printTable = (results) => {
  const extraCodes = [
    ...new Set(results.flatMap((r) => Object.keys(r.byCode)).filter((code) => !ALWAYS_CODES.includes(code))),
  ].sort()
  const codes = [...ALWAYS_CODES, ...extraCodes]

  const header = ['package', 'total', ...codes]
  const rows = results.map((r) => [r.dir, String(r.total), ...codes.map((code) => String(r.byCode[code] ?? 0))])
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i].length)))
  const line = (cells) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ')

  console.log(line(header))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(line(row))

  for (const result of results.filter((r) => r.total > 0)) {
    console.log(`\n${result.dir} — ${result.total} error(s):`)
    for (const e of result.errors.slice(0, 20)) {
      console.log(`  ${e.file}(${e.line},${e.column}): ${e.code} ${e.message}`)
    }
    if (result.errors.length > 20) console.log(`  …and ${result.errors.length - 20} more`)
  }
}

const parseArgs = (argv) => {
  const flags = { repo: null, packages: [], checkEsm: false, list: false, json: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--repo') flags.repo = argv[++i]
    else if (arg.startsWith('--repo=')) flags.repo = arg.slice('--repo='.length)
    else if (arg === '--package') flags.packages.push(argv[++i])
    else if (arg.startsWith('--package=')) flags.packages.push(arg.slice('--package='.length))
    else if (arg === '--check-esm') flags.checkEsm = true
    else if (arg === '--list') flags.list = true
    else if (arg === '--json') flags.json = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (!flags.repo) throw new Error('Missing --repo <name> (resolved under the vendor.json workspaceDir).')

  return flags
}

const runCheckEsm = (setG) => {
  const missing = setG.filter((pkg) => {
    const { type } = JSON.parse(readFileSync(join(pkg.packageDir, 'package.json'), 'utf8'))
    return type !== 'module'
  })

  console.log(`${setG.length - missing.length}/${setG.length} Set G packages declare "type": "module"`)

  if (missing.length === 0) return 0

  for (const pkg of missing) console.log(`  ❌ ${pkg.dir}`)

  return 1
}

const main = () => {
  const flags = parseArgs(process.argv.slice(2))
  const repoRoot = resolveRepoRoot(flags.repo)
  const setG = deriveSetG(repoRoot)

  noteForkedTsconfigs(repoRoot, setG, 'probing')

  if (flags.list) {
    for (const pkg of setG) console.log(pkg.dir)
    return 0
  }

  if (flags.checkEsm) return runCheckEsm(setG)

  const packages = selectPackages(setG, flags.packages)

  // The probe type-checks against dependencies' committed `dist/`, so a stale build reports errors
  // that belong to the previous state of the code. Requirement 2 leaves the build to the caller.
  process.stderr.write("reminder: dependencies' dist/ must be current — `pnpm exec turbo run build --force`\n")

  const tempRoot = mkdtempSync(join(tmpdir(), 'probe-nodenext-'))
  const results = []

  for (const [index, pkg] of packages.entries()) {
    process.stderr.write(`[${index + 1}/${packages.length}] ${pkg.dir}\n`)
    results.push(probePackage(repoRoot, tempRoot, pkg))
  }

  if (flags.json) console.log(JSON.stringify({ packages: results }, null, 2))
  else printTable(results)

  return results.some((result) => result.total > 0) ? 1 : 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`💥 ${error.message}`)
  process.exitCode = 1
}
