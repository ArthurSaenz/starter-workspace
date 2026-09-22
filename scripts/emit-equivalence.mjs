import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import {
  buildBaseTsconfig,
  deriveSetG,
  mapWithProgress,
  noteForkedTsconfigs,
  parseErrors,
  readTsconfig,
  printTable as renderTable,
  resolveRepoRoot,
  runMain,
  runTsc,
  selectPackages,
} from './lib/set-g.mjs'

// Longest suffix first: `.d.ts.map` also ends in `.map`, and `.d.ts` also ends in `.ts`.
const EMIT_KINDS = ['.d.ts.map', '.js.map', '.d.ts', '.js']

const MAX_DIFFS_SHOWN = 3
const MAX_DIFF_LINES = 40

const kindOf = (path) => EMIT_KINDS.find((suffix) => path.endsWith(suffix)) ?? 'other'

const walkEmit = (root, base = root, acc = []) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)

    if (entry.isDirectory()) walkEmit(path, base, acc)
    else acc.push(relative(base, path))
  }

  return acc.sort()
}

const countKinds = (files) => {
  const counts = {}

  for (const file of files) counts[kindOf(file)] = (counts[kindOf(file)] ?? 0) + 1

  return counts
}

const NODENEXT = { module: 'NodeNext', moduleResolution: 'NodeNext' }
// What every consumer had before plan step 2.4; `--baseline=bundler` pins side A to it so the gate
// still measures something in a repo whose committed config is already NodeNext.
const BUNDLER = { module: 'ES2022', moduleResolution: 'Bundler' }

const buildTsconfig = (repoRoot, pkg, outDir, resolution) => {
  const base = buildBaseTsconfig(repoRoot, pkg)

  return {
    ...base,
    compilerOptions: {
      ...base.compilerOptions,
      // Emit is the measurement, so everything that changes emit is pinned identically on both
      // sides; only `module`/`moduleResolution` are allowed to differ.
      ...resolution,
      composite: false,
      incremental: false,
      noEmit: false,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      outDir,
    },
  }
}

const compile = (repoRoot, workDir, pkg, side, resolution) => {
  const outDir = join(workDir, side)
  const configPath = join(workDir, `${side}.tsconfig.json`)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(buildTsconfig(repoRoot, pkg, outDir, resolution), null, 2)}\n`)

  const errors = parseErrors(repoRoot, runTsc(repoRoot, configPath))

  return { outDir, errors, files: errors.length > 0 ? [] : walkEmit(outDir) }
}

// The system `diff`, as elsewhere in this scripts dir, rather than a hand-rolled LCS. It exits 1 when
// the files differ, which is the expected path here.
const unifiedDiff = (a, b) => {
  try {
    execFileSync('diff', ['-u', a, b], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return ''
  } catch (error) {
    if (error.stdout == null) throw error
    return error.stdout
  }
}

const comparePackage = (repoRoot, tempRoot, pkg, baseline) => {
  // A `noEmit` package (hulyo `packages/mongo-cli`: no `build` script, run as `node src/check.ts`)
  // has no emit to compare, and forcing emit on it is not even a valid config — its
  // `allowImportingTsExtensions` is legal only while it never emits. Excluded from the tally rather
  // than reported as a failure.
  if (readTsconfig(pkg.tsconfigPath).compilerOptions?.noEmit === true) {
    return { dir: pkg.dir, status: 'SKIPPED-NOEMIT', before: null, after: null, differing: [] }
  }

  // Sibling one-character output dirs at equal depth: a sourcemap's `sources` entry is relative to
  // the map file, so two outDirs of different depth or name length would differ in every map for a
  // reason that has nothing to do with module resolution.
  const workDir = join(tempRoot, pkg.dir.replace(/\//g, '__'))
  mkdirSync(workDir, { recursive: true })

  const before = compile(repoRoot, workDir, pkg, 'a', baseline)

  if (before.errors.length > 0) return { dir: pkg.dir, status: 'BASELINE-FAILED', before, after: null, differing: [] }

  const after = compile(repoRoot, workDir, pkg, 'b', NODENEXT)

  if (after.errors.length > 0) return { dir: pkg.dir, status: 'NODENEXT-FAILED', before, after, differing: [] }

  const onlyBefore = before.files.filter((file) => !after.files.includes(file))
  const onlyAfter = after.files.filter((file) => !before.files.includes(file))
  const shared = before.files.filter((file) => after.files.includes(file))

  const changed = shared.filter(
    (file) => !readFileSync(join(before.outDir, file)).equals(readFileSync(join(after.outDir, file))),
  )

  const differing = [
    ...onlyBefore.map((file) => ({ file, reason: 'only in baseline' })),
    ...onlyAfter.map((file) => ({ file, reason: 'only in NodeNext' })),
    ...changed.map((file) => ({ file, reason: 'contents differ' })),
  ]

  return {
    dir: pkg.dir,
    status: differing.length === 0 ? 'IDENTICAL' : 'DIFFERENT',
    before,
    after,
    differing,
  }
}

const cell = (result, kind) => {
  const a = result.before?.files ? (countKinds(result.before.files)[kind] ?? 0) : 0
  const b = result.after?.files ? (countKinds(result.after.files)[kind] ?? 0) : 0

  return a === b ? String(a) : `${a}/${b}`
}

const printTable = (results) => {
  const header = ['package', ...EMIT_KINDS, 'verdict']
  const rows = results.map((r) => [r.dir, ...EMIT_KINDS.map((kind) => cell(r, kind)), r.status])

  renderTable(header, rows)
}

const printFailure = (result) => {
  const side = result.status === 'BASELINE-FAILED' ? result.before : result.after
  const label = result.status === 'BASELINE-FAILED' ? 'baseline (committed vendor config)' : 'NodeNext'

  console.log(`\n${result.dir} — ${side.errors.length} compile error(s) in the ${label} build:`)
  for (const e of side.errors.slice(0, 20)) console.log(`  ${e.file}(${e.line},${e.column}): ${e.code} ${e.message}`)
  if (side.errors.length > 20) console.log(`  …and ${side.errors.length - 20} more`)
}

const printDifference = (result) => {
  console.log(`\n${result.dir} — ${result.differing.length} differing file(s):`)
  for (const { file, reason } of result.differing) console.log(`  ${file} (${reason})`)

  for (const { file, reason } of result.differing.slice(0, MAX_DIFFS_SHOWN)) {
    if (reason !== 'contents differ') continue

    const lines = unifiedDiff(join(result.before.outDir, file), join(result.after.outDir, file)).split('\n')

    console.log(`\n  --- diff ${file} (baseline → NodeNext) ---`)
    for (const text of lines.slice(0, MAX_DIFF_LINES)) console.log(`  ${text}`)
    if (lines.length > MAX_DIFF_LINES) console.log(`  …diff truncated at ${MAX_DIFF_LINES} lines`)
  }
}

const parseArgs = (argv) => {
  const flags = { mode: 'config', repo: null, packages: [], baseline: 'committed' }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--mode') flags.mode = argv[++i]
    else if (arg.startsWith('--mode=')) flags.mode = arg.slice('--mode='.length)
    else if (arg === '--baseline') flags.baseline = argv[++i]
    else if (arg.startsWith('--baseline=')) flags.baseline = arg.slice('--baseline='.length)
    else if (arg === '--repo') flags.repo = argv[++i]
    else if (arg.startsWith('--repo=')) flags.repo = arg.slice('--repo='.length)
    else if (arg === '--package') flags.packages.push(argv[++i])
    else if (arg.startsWith('--package=')) flags.packages.push(arg.slice('--package='.length))
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (!['config', 'codemod'].includes(flags.mode)) throw new Error(`Unknown --mode: ${flags.mode}`)
  if (!['committed', 'bundler'].includes(flags.baseline)) throw new Error(`Unknown --baseline: ${flags.baseline}`)
  if (!flags.repo) throw new Error('Missing --repo <name> (resolved under the vendor.json workspaceDir).')

  return flags
}

// By default the baseline side inherits `module`/`moduleResolution` from whatever the repo has
// committed. Once a repo is synced past plan step 2.4 that is already NodeNext, and the comparison
// compares NodeNext with itself — a pass that proves nothing. Say so, and point at `--baseline=bundler`,
// rather than reporting a vacuous IDENTICAL.
const reportBaseline = (repoRoot, pkg, baseline) => {
  const vendorConfig = buildBaseTsconfig(repoRoot, pkg).extends
  const committed = readTsconfig(vendorConfig).compilerOptions ?? {}
  const { module, moduleResolution } = baseline === BUNDLER ? BUNDLER : committed

  console.log(
    `baseline: ${baseline === BUNDLER ? 'forced' : relative(repoRoot, vendorConfig)} — module=${module}, moduleResolution=${moduleResolution}`,
  )

  if (String(moduleResolution).toLowerCase() === 'nodenext') {
    process.stderr.write(
      'WARNING: the committed vendor config already resolves as NodeNext, so both sides of this ' +
        'comparison are NodeNext and an IDENTICAL verdict is vacuous. Pass --baseline=bundler.\n',
    )
  }
}

const main = () => {
  const flags = parseArgs(process.argv.slice(2))

  if (flags.mode === 'codemod') {
    console.log('--mode=codemod: not implemented in this phase')
    return 2
  }

  const repoRoot = resolveRepoRoot(flags.repo)
  const setG = deriveSetG(repoRoot)

  noteForkedTsconfigs(repoRoot, setG, 'building')

  const packages = selectPackages(setG, flags.packages)
  const baseline = flags.baseline === 'bundler' ? BUNDLER : {}

  reportBaseline(repoRoot, packages[0], baseline)
  console.log('')

  const tempRoot = mkdtempSync(join(tmpdir(), 'emit-equivalence-'))
  const results = mapWithProgress(packages, (pkg) => comparePackage(repoRoot, tempRoot, pkg, baseline))

  printTable(results)

  for (const result of results) {
    if (result.status === 'DIFFERENT') printDifference(result)
    else if (result.status.endsWith('FAILED')) printFailure(result)
  }

  const comparable = results.filter((result) => result.status !== 'SKIPPED-NOEMIT')
  const skipped = results.length - comparable.length
  const identical = comparable.filter((result) => result.status === 'IDENTICAL').length

  console.log(`\n${identical}/${comparable.length} identical${skipped > 0 ? ` (${skipped} skipped, no emit)` : ''}`)

  return identical === comparable.length ? 0 : 1
}

runMain(main)
