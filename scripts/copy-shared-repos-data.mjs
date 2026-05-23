import { exec } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import util from 'node:util'

const execFn = util.promisify(exec)

const PROJECT_ROOT = join(process.env.HOME, 'projects')
const WORKSPACE_ROOT = join(PROJECT_ROOT, 'starter-workspace')

const TARGET_REPOS = ['travelist-monorepo', 'hulyo-monorepo', 'sandbox-workspace', 'infra-kit', 'nomadream-monorepo']

const EXCLUDED_PATTERNS = ['node_modules', 'dist', '*.tsbuildinfo', '.turbo', '.eslintcache', '.omc', '__screenshots__', '.output', '.source', '.nitro', '.tanstack']

// Root of the mirrored ("vendored") tree inside each consumer repo.
const VENDOR_DIR = 'vendor'

// Legacy locations that earlier syncs wrote at the repo root. The sync only removes its own
// target paths, so without an explicit pre-clean a stale copy here would collide with the new
// `vendor/` package of the same `@pkg/*` name and break pnpm. Removed before copying.
const LEGACY_CLEANUP = ['packages/web-toolkit', 'packages/lib-be-dev', 'configs']

// Files/dirs skipped when walking `vendor/` to build the integrity manifest.
const MANIFEST_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.omc', '__screenshots__', '.output', '.source', '.nitro', '.tanstack'])
const MANIFEST_SKIP_FILES = new Set(['.sync-manifest.json', '.eslintcache'])
const MANIFEST_SKIP_SUFFIXES = ['.tsbuildinfo']

// Configuration for files and folders to copy. `vendored: true` marks workspace packages that
// must land under `vendor/` in consumers (the single-source-of-truth code). Everything else is
// root-level tooling/CI/editor config that tools expect at the repo root and stays there.
const COPY_CONFIG = [
  {
    name: 'Claude code configs',
    source: '.claude',
    target: '.claude',
    type: 'directory',
  },
  {
    name: 'MCPs for Cursor',
    source: '.cursor/mcp.json',
    target: '.cursor/mcp.json',
    type: 'file',
  },
  {
    name: 'MCPs for Claude',
    source: '.mcp.json',
    target: '.mcp.json',
    type: 'file',
  },
  {
    name: 'Cursor rules',
    source: '.cursor/rules',
    target: '.cursor/rules',
    type: 'directory',
  },
  {
    name: 'Make scripts',
    source: 'Makefile',
    target: 'Makefile',
    type: 'file',
  },
  {
    name: 'Web-toolkit',
    source: 'vendor/packages/web-toolkit',
    target: `${VENDOR_DIR}/packages/web-toolkit`,
    type: 'directory',
    vendored: true,
  },
  {
    name: 'VsCode extensions',
    source: '.vscode/extensions.json',
    target: '.vscode/extensions.json',
    type: 'file',
  },
  {
    name: 'VsCode snippets',
    source: '.vscode/global.code-snippets',
    target: '.vscode/global.code-snippets',
    type: 'file',
  },
  {
    name: 'VsCode settings',
    source: '.vscode/settings.json',
    target: '.vscode/settings.json',
    type: 'file',
  },
  {
    name: 'Prettier config',
    source: '.prettierrc.mjs',
    target: '.prettierrc.mjs',
    type: 'file',
  },
  {
    name: 'Prettier ignore',
    source: '.prettierignore',
    target: '.prettierignore',
    type: 'file',
  },
  {
    name: 'Node version',
    source: '.node-version',
    target: '.node-version',
    type: 'file',
  },
  {
    name: 'Git ignore',
    source: '.gitignore',
    target: '.gitignore',
    type: 'file',
  },
  {
    name: 'Editor config',
    source: '.editorconfig',
    target: '.editorconfig',
    type: 'file',
  },
  {
    name: 'Vitest config',
    source: 'vitest.config.ts',
    target: 'vitest.config.ts',
    type: 'file',
  },
  {
    name: 'Skills lock',
    source: 'skills-lock.json',
    target: 'skills-lock.json',
    type: 'file',
  },
  {
    name: 'Agents',
    source: '.agents',
    target: '.agents',
    type: 'directory',
  },
  {
    name: 'Turbo config',
    source: 'turbo.json',
    target: 'turbo.json',
    type: 'file',
  },
  {
    name: 'Configs',
    source: 'vendor/configs',
    target: `${VENDOR_DIR}/configs`,
    type: 'directory',
    vendored: true,
  },
  {
    name: 'Deploy and E2E scripts lib',
    source: 'devops/scripts/lib',
    target: 'devops/scripts/lib',
    type: 'directory',
  },
  {
    name: 'Vendor drift-check script',
    source: 'scripts/vendor-check.mjs',
    target: 'scripts/vendor-check.mjs',
    type: 'file',
  },
  {
    name: 'Lib BE Dev',
    source: 'vendor/packages/lib-be-dev',
    target: `${VENDOR_DIR}/packages/lib-be-dev`,
    type: 'directory',
    vendored: true,
  },
  {
    name: 'Docs UI template',
    source: 'vendor/packages/docs-ui',
    target: `${VENDOR_DIR}/packages/docs-ui`,
    type: 'directory',
    vendored: true,
  },
  {
    name: 'GH Workflow: Cache Node Modules',
    source: '.github/workflows/_cache-nodemodules-jobs.yml',
    target: '.github/workflows/_cache-nodemodules-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Code Quality Jobs',
    source: '.github/workflows/_code-quality-jobs.yml',
    target: '.github/workflows/_code-quality-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Deploy Media Jobs',
    source: '.github/workflows/_deploy-media-jobs.yml',
    target: '.github/workflows/_deploy-media-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Notify Success Jobs',
    source: '.github/workflows/_notify-success-jobs.yml',
    target: '.github/workflows/_notify-success-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Playwright Jobs',
    source: '.github/workflows/_playwright-jobs.yml',
    target: '.github/workflows/_playwright-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Terraform Apply Infrastructure',
    source: '.github/workflows/_terraform-apply-infrastructure-jobs.yml',
    target: '.github/workflows/_terraform-apply-infrastructure-jobs.yml',
    type: 'file',
  },
  {
    name: 'GH Workflow: Code Quality',
    source: '.github/workflows/code-quality.yml',
    target: '.github/workflows/code-quality.yml',
    type: 'file',
  },
]

const parseArgs = (argv) => {
  const flags = { check: false, manifestOnly: false, clean: true, repos: null }

  for (const arg of argv) {
    if (arg === '--check') flags.check = true
    else if (arg === '--manifest-only') flags.manifestOnly = true
    else if (arg === '--no-clean') flags.clean = false
    else if (arg.startsWith('--repos=')) flags.repos = arg.slice('--repos='.length).split(',').filter(Boolean)
  }

  return flags
}

const excludeFlags = () => EXCLUDED_PATTERNS.map((p) => `--exclude='${p}'`).join(' ')

const copyDirectory = async (source, target, displayTarget) => {
  if (!existsSync(source)) {
    console.log(`⚠️  Source directory does not exist: ${source}`)
    return false
  }

  try {
    // Remove target directory if it exists to avoid nested copying
    if (existsSync(target)) {
      await execFn(`rm -rf "${target}"`)
    }

    await execFn(`rsync -a ${excludeFlags()} "${source}/" "${target}/"`)

    console.log(`✅ Copied: ${displayTarget}`)

    return true
  } catch (error) {
    console.log(`❌ Failed to copy: ${displayTarget}`)
    console.error(error.message)
    return false
  }
}

const copyFile = async (source, target, displayTarget) => {
  if (!existsSync(source)) {
    console.log(`⚠️  Source file does not exist: ${source}`)

    return false
  }

  try {
    const targetDir = dirname(target)

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    await execFn(`cp "${source}" "${target}"`)
    console.log(`✅ Copied: ${displayTarget}`)

    return true
  } catch (error) {
    console.log(`❌ Failed to copy: ${displayTarget}`)
    console.error(error.message)
    return false
  }
}

// Dry-run rsync that reports whether the target has drifted from the source. Returns the list of
// itemized changes (empty = in sync). `--delete` surfaces files that exist only in the consumer.
const diffDirectory = async (source, target) => {
  if (!existsSync(source)) return []
  if (!existsSync(target)) return [`missing target: ${target}`]

  const { stdout } = await execFn(
    `rsync -ai --dry-run --delete ${excludeFlags()} "${source}/" "${target}/"`,
  )

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const removeLegacyLocations = async (targetRoot) => {
  for (const legacy of LEGACY_CLEANUP) {
    const legacyPath = join(targetRoot, legacy)

    if (existsSync(legacyPath)) {
      await execFn(`rm -rf "${legacyPath}"`)
      console.log(`🧹 Removed legacy location: ${legacy}`)
    }
  }
}

const walkFiles = (root, base = root, acc = []) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (MANIFEST_SKIP_DIRS.has(entry.name)) continue
      walkFiles(join(root, entry.name), base, acc)
      continue
    }

    if (MANIFEST_SKIP_FILES.has(entry.name)) continue
    if (MANIFEST_SKIP_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue

    acc.push(relative(base, join(root, entry.name)))
  }

  return acc
}

const sha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex')

const getStarterCommit = async () => {
  try {
    const { stdout } = await execFn(`git -C "${WORKSPACE_ROOT}" rev-parse HEAD`)
    return stdout.trim()
  } catch {
    return 'unknown'
  }
}

const VENDOR_README = `# vendor/ — mirrored from starter-workspace

**DO NOT EDIT files in this folder here.**

Everything under \`vendor/\` is the single source of truth maintained in
\`starter-workspace\` and copied into this repo by
\`starter-workspace/scripts/copy-shared-repos-data.mjs\`. Local edits are
overwritten on the next sync and will fail \`pnpm vendor:check\` in CI.

To change a vendored package, edit it in \`starter-workspace\` and re-run the sync.

See \`.sync-manifest.json\` for the source commit and per-file checksums.
`

const writeVendorMeta = async (targetRoot, commit) => {
  const vendorRoot = join(targetRoot, VENDOR_DIR)

  if (!existsSync(vendorRoot)) {
    console.log(`⚠️  No ${VENDOR_DIR}/ folder to describe in ${targetRoot}`)
    return
  }

  writeFileSync(join(vendorRoot, 'README.md'), VENDOR_README)

  const files = {}
  for (const rel of walkFiles(vendorRoot).sort()) {
    files[rel] = sha256(join(vendorRoot, rel))
  }

  const manifest = {
    source: 'starter-workspace',
    commit,
    syncedAt: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    files,
  }

  writeFileSync(join(vendorRoot, '.sync-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`📝 Wrote ${VENDOR_DIR}/.sync-manifest.json (${manifest.fileCount} files) + README.md`)
}

const resolveRepos = (flags) => {
  if (!flags.repos) return TARGET_REPOS

  const unknown = flags.repos.filter((r) => !TARGET_REPOS.includes(r))
  if (unknown.length) console.log(`⚠️  Ignoring unknown repos: ${unknown.join(', ')}`)

  return TARGET_REPOS.filter((r) => flags.repos.includes(r))
}

const runCheck = async (repos) => {
  console.log('🔍 Drift check (consumer vendor/ vs starter source)...\n')

  let drifted = 0

  for (const repo of repos) {
    const targetRoot = `${PROJECT_ROOT}/${repo}`
    if (!existsSync(targetRoot)) continue

    console.log(`📦 ${repo}`)

    for (const item of COPY_CONFIG.filter((i) => i.vendored)) {
      const source = join(WORKSPACE_ROOT, item.source)
      const target = join(targetRoot, item.target)
      const changes = await diffDirectory(source, target)

      if (changes.length) {
        drifted++
        console.log(`  ❌ DRIFT in ${item.target} (${changes.length} change(s)):`)
        for (const change of changes.slice(0, 20)) console.log(`     ${change}`)
        if (changes.length > 20) console.log(`     …and ${changes.length - 20} more`)
      } else {
        console.log(`  ✅ ${item.target}`)
      }
    }

    console.log('')
  }

  if (drifted) {
    console.log(`❌ Drift detected in ${drifted} vendored path(s).`)
    process.exit(1)
  }

  console.log('🎉 No drift detected.')
}

const runManifestOnly = async (repos, commit) => {
  console.log('📝 Regenerating vendor manifests from current content (no copy)...\n')

  for (const repo of repos) {
    const targetRoot = `${PROJECT_ROOT}/${repo}`
    if (!existsSync(targetRoot)) continue

    console.log(`📦 ${repo}`)
    await writeVendorMeta(targetRoot, commit)
    console.log('')
  }
}

const runSync = async (repos, flags, commit) => {
  console.log('🚀 Starting White-Label Sync...\n')

  let successCount = 0
  let totalCount = 0

  for (const repo of repos) {
    const targetRoot = `${PROJECT_ROOT}/${repo}`

    console.log(`📦 Processing repository: ${repo}`)

    if (!existsSync(targetRoot)) {
      console.log(`⚠️  Target repository does not exist: ${targetRoot}`)
      continue
    }

    if (flags.clean) {
      await removeLegacyLocations(targetRoot)
    }

    for (const item of COPY_CONFIG) {
      const sourcePath = join(WORKSPACE_ROOT, item.source)
      const targetPath = join(targetRoot, item.target)

      totalCount++
      let success = false

      if (item.type === 'directory') {
        success = await copyDirectory(sourcePath, targetPath, item.target)
      }

      if (item.type === 'file') {
        success = await copyFile(sourcePath, targetPath, item.target)
      }

      if (success) {
        successCount++
      }
    }

    await writeVendorMeta(targetRoot, commit)

    console.log('') // Empty line for readability
  }

  console.log('📊 Copy Process Summary:')
  console.log(`✅ Successful copies: ${successCount}/${totalCount}`)
  if (successCount < totalCount) {
    console.log(`❌ Failed copies: ${totalCount - successCount}/${totalCount}`)
  }

  if (successCount === totalCount) {
    console.log('🎉 All files copied successfully!')
  } else {
    console.log('⚠️  Some files failed to copy. Check the output above for details.')
  }
}

const main = async () => {
  const flags = parseArgs(process.argv.slice(2))
  const repos = resolveRepos(flags)
  const commit = await getStarterCommit()

  if (flags.check) {
    await runCheck(repos)
    return
  }

  if (flags.manifestOnly) {
    await runManifestOnly(repos, commit)
    return
  }

  await runSync(repos, flags, commit)
}

// Run the main function
main().catch((error) => {
  console.error('💥 Script failed with error:', error)
  process.exit(1)
})
