# White-Label Sync — Structure & Naming Proposal

> Investigation of how reusable code is mirrored from `starter-workspace` into the
> consumer monorepos, with naming options for a dedicated folder and a phased
> improvement plan.
> Source of truth: `starter-workspace/scripts/copy-shared-repos-data.mjs`.

---

## TL;DR

- One script (`copy-shared-repos-data.mjs`) rsyncs **~30 paths** from `starter-workspace`
  into 5 repos (`travelist`, `hulyo`, `sandbox-workspace`, `infra-kit`, `nomadream`).
- The mirrored **workspace packages** (`web-toolkit`, `lib-be-dev`, all of `configs/*`)
  sit **interleaved** with each repo's own packages in `packages/` and `configs/`.
  Nothing marks them as "managed upstream — do not edit here."
- The `@pkg/*` namespace does **not** help: repo-owned packages (`@pkg/lib-core`,
  `@pkg/lib-db`) and mirrored ones (`@wl/web-toolkit`) share the same namespace.
- **Drift already exists**: `configs/eslint-config/index.js` and several
  `web-toolkit/src/experiments/*` files differ between starter and hulyo. The copy is
  one-way and destructive (`rm -rf` + `rsync`), so local edits are silently overwritten
  on the next sync — or the upstream is already stale.
- **Recommended folder name: `vendor/`** (alternates: `upstream/`, `synced/`).
  Avoid `generated/` — it implies machine-generated/disposable output, which misleads.
- **Moving the packages is low-risk**: all 324 references are by package name
  (`@pkg/...`), **zero** by relative folder path. A folder move + one pnpm workspace
  glob change breaks no imports.

---

## 1. What is actually being mirrored

The script copies five categories. Only category **A** is "packages"; the rest are
config/CI/editor files that happen to ride the same mechanism.

| # | Category | Paths | Nature |
|---|----------|-------|--------|
| **A** | **Workspace packages** | `packages/web-toolkit`, `packages/lib-be-dev`, `configs/*` (eslint-config, prettier-config, serverless-config, storybook-config, ts-config, vitest-config) | **Real code, `@pkg/*`** |
| B | Root tooling configs | `Makefile`, `.prettierrc.mjs`, `.prettierignore`, `.node-version`, `.gitignore`, `.editorconfig`, `vitest.config.ts`, `skills-lock.json`, `turbo.json` | Dotfiles |
| C | AI / editor configs | `.claude/`, `.cursor/mcp.json`, `.cursor/rules/`, `.agents/`, `.vscode/{extensions,global.code-snippets,settings}` | Dotfiles |
| D | CI | `.github/workflows/_*.yml` (reusable) + `code-quality.yml` | CI |
| E | Devops | `devops/scripts/lib` | Scripts |

The user's question is about **category A** (the packages). Categories B–E are
genuinely root-level concerns and should *stay* at the root — see §5.

## 2. Problems found (evidence-backed)

1. **No structural separation.** Mirrored packages live next to repo-owned ones:
   - `packages/`: mirrored `web-toolkit`, `lib-be-dev` ⟷ owned `lib-core`, `lib-db`,
     `data-source-connectors`, `svg-sprites`, …
   - `configs/`: **entirely** mirrored (all 6) — but a reader can't know that without
     reading the copy script.
2. **Namespace is no help.** Everything is `@pkg/*`, so you cannot filter "mirrored vs
   owned" by name (e.g. the `packages-build` script's `--filter=@pkg*` matches both).
3. **Drift is real and silent.** `diff -rq starter hulyo` shows divergence in
   `configs/eslint-config/index.js`, `configs/eslint-config/package.json`, and
   `web-toolkit/src/experiments/{define,init-script}.tsx`; hulyo has files starter
   lacks (`web-toolkit/src/jotai-promise-atom`). Because the copy does `rm -rf` then
   `rsync`, **local fixes get destroyed on the next sync** unless they were also made
   upstream.
4. **Sync is invisible & manual.** No manifest in the consumer records *what* was
   vendored, *from which version*, or *when*. No drift detection. No CI guard. The only
   "source of truth" for the file list is a hardcoded array in one script.
5. **State noise leaks in.** `.omc/state/*.jsonl` and `__screenshots__` show up inside
   the mirrored trees — non-deterministic content riding the copy.

## 3. Naming options for the dedicated folder

Property to convey: *first-party shared code, mirrored from the white-label source of
truth, do-not-edit-here (edit upstream).*

| Rank | Name | Signal | Trade-off |
|------|------|--------|-----------|
| ★ **1** | **`vendor/`** | "Copied-in code you don't edit here." Strong precedent (Go, Composer). | Conventionally *third-party*; here it's first-party-internal. Minor semantic stretch, universally understood. |
| 2 | `upstream/` | Most accurate to the relationship: owned upstream, mirrored down. | Less common as a folder name; needs a one-line README. |
| 3 | `synced/` | Honest about the mechanism; pairs naturally with a `.sync-manifest.json`. | Describes *how* not *what*. |
| 4 | `platform/` | Frames it as platform-team-owned foundation. | Ownership framing, not "don't edit" framing. |
| 5 | `white-label/` (`wl/`) | Domain-explicit; ties to the business concept. | Verbose; conflates "the system" with "the folder." |
| ✗ | `generated/` *(your suggestion)* | — | **Avoid.** Implies machine-generated/disposable output safe to delete & regenerate. This is authored source mirrored from elsewhere — readers will treat it wrong. |

**Recommendation: `vendor/`.** It is the most widely recognized "mirrored, hands-off"
convention and needs the least explanation. If you prefer to emphasize the *source*
relationship over the convention, `upstream/` is the strongest second.

## 4. Recommended structure

Mirror the source layout under one folder so the copy script becomes a **single rsync**:

```
<repo>/
  apps/                 # repo-owned (unchanged)
  packages/             # repo-owned ONLY (lib-core, lib-db, svg-sprites, …)
  vendor/               # ← mirrored from starter-workspace, DO NOT EDIT HERE
    packages/
      web-toolkit/
      lib-be-dev/
    configs/
      eslint-config/  prettier-config/  serverless-config/
      storybook-config/ ts-config/      vitest-config/
    README.md             # "Mirrored from starter-workspace. Edit there, run sync."
    .sync-manifest.json   # source repo + commit/tag + path list + timestamp
```

**Why this is safe / what changes:**

| Change | Detail | Blast radius |
|--------|--------|--------------|
| `pnpm-workspace.yaml` | Add `vendor/packages/*`, `vendor/configs/*`; remove `configs/*` if fully vendored | 1 line each, 5 repos |
| Copy script | `COPY_CONFIG` source/target → `vendor/...`; ideally collapse to one `vendor/` rsync | 1 file |
| **Imports** | **None.** 293 refs to `@wl/web-toolkit` + 31 to `@wl/ts-config` are **all by package name**; **0** by relative folder path. pnpm resolves by name via workspace symlinks. | **0 files** |
| `turbo.json` filters | `--filter=@pkg*` still matches (names unchanged) | none, unless you also re-namespace (§6) |

The headline: **because nothing imports these by path, relocation is mechanical.**

## 5. Keep at root (do NOT move into `vendor/`)

Categories B–E are legitimately root-level: `turbo.json`, `.prettierrc.mjs`,
`.gitignore`, `.github/workflows/*`, `devops/scripts/lib`, `.claude/`, `.cursor/`, etc.
They must live where the tools expect them. They're *also* mirrored, but the fix for
those is the **manifest + drift guard** (§6), not relocation. Don't try to force them
into `vendor/` — you'll fight every tool's path expectations.

## 6. Future improvements (phased)

**Phase 0 — Make it visible (cheap, do first).**
- Introduce `vendor/` (§4).
- Add `vendor/.sync-manifest.json` written by the copy script: `{ source, commit, syncedAt, paths[] }`.
- Add `vendor/README.md` banner: "Mirrored from starter-workspace — edit upstream."
- `CODEOWNERS`: route `vendor/**` to the platform/starter owners.
- Exclude `.omc`, `__screenshots__`, `*.tsbuildinfo` from the copy (extend `EXCLUDED_PATTERNS`).

**Phase 1 — Make drift safe.**
- Copy script gains a `--check` mode (rsync `--dry-run`): non-empty diff → non-zero exit.
- Wire `--check` into CI (same pattern as `prettier-check`) so an edited vendored file
  fails the build with a clear "edit this upstream in starter-workspace" message.
- Refuse destructive overwrite when local drift is detected unless `--force`; print the diff.

**Phase 2 — Stop copy-pasting (pick one).**
- **git subtree** (lowest friction): keeps history, supports `pull` *and* `push` back to
  starter. Single source of truth preserved, both directions possible, no registry infra.
- **Private registry** (cleanest): publish `@wl/web-toolkit` etc. to GitHub Packages /
  npm; consumers depend on pinned versions via the catalog. Needs publish + version-bump
  flow. Best end-state; highest setup cost.

**Phase 3 — First-class tooling.**
- Fold the sync into `infra-kit` (already the repos' CLI) as `infra-kit white-label-sync`
  with version pinning, so every repo records `starter@vX.Y.Z` and updates are deliberate.

**Optional — Re-namespace mirrored packages.**
Rename mirrored packages `@pkg/*` → `@wl/*` (or `@vendor/*`) while leaving repo-owned as
`@pkg/*`. Then "mirrored vs owned" is filterable by name (`turbo --filter=@wl/*`) and
import sites self-document. High value, but touches all 324 import sites + the
`packages-build` filter — defer to after Phase 0/1 prove out.

## 7. Decision needed

1. **Folder name** — `vendor/` (recommended), `upstream/`, or `synced/`?
2. **Scope of move** — packages only (`web-toolkit`, `lib-be-dev`, `configs/*`), or also
   adopt the manifest + CI drift guard now (Phase 0/1)?
3. **End-state** — stay copy-paste long-term, or commit to git-subtree / registry (Phase 2)?
