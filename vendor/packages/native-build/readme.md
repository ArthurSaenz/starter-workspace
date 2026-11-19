# @wl/native-build

One-shot native build for a Capacitor app: derive and stamp the version into `android/app/build.gradle` and
`ios/App/App.xcodeproj/project.pbxproj`, build the MFE host bundle against the target domain, and sync it into
`ios/` and `android/`. Archiving and uploading stay manual in Xcode / Android Studio.

The bin is TypeScript run by Node's type stripping, so the package has no build step.

## Consumer setup

In the Capacitor app's `package.json`:

```json
{
  "scripts": {
    "build-native-dev": "wl-native-build dev --domain https://dev.example.com",
    "build-native-prod": "wl-native-build prod --domain https://www.example.com"
  },
  "devDependencies": {
    "@wl/native-build": "workspace:*"
  }
}
```

The app must hold both native files and the scripts `_build` and `sync`. The repo root is the nearest ancestor
with `pnpm-workspace.yaml`; turbo builds the app's dependencies with `--filter=<app name>^...`.

## CLI

```sh
pnpm run build-native-dev --dry-run
pnpm run build-native-prod
```

| Element                      | Required | Meaning                                                                                      |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `dev` \| `prod`              | yes      | the target environment                                                                       |
| `--domain <https-url>`       | yes      | the MFE origin the bundle loads; set in the consumer script                                  |
| `--version <x.y.z>`          | no       | stamp this version instead of the derived one: starts a new major or confirms a prod rebuild |
| `--dry-run`                  | no       | print the derived plan; write and run nothing except `git fetch`                             |
| `--help`                     | no       | show the usage                                                                               |
| env `VITE_MOBILE_DOMAIN_URL` | —        | must have the same origin as `--domain` when set, otherwise the run exits 2                  |
| env `DEVELOPER_DIR`          | —        | set for `cap sync` when `/Applications/Xcode.app` exists                                     |

For a one-off domain, such as a preview environment, call the bin directly:

```sh
pnpm exec wl-native-build dev --domain <preview-url>
```

A non-zero `cap sync` exit is only a warning: its final `xcodebuild clean` can fail after the copy and pod install
are done. The build then passes only if both synced bundles reference `<domain>/mfe/remoteEntry.js`.

Exit codes: `0` success; `1` build, bundle-assertion or git plumbing failure; `2` usage error, contract violation, domain
mismatch, disagreeing majors, a `--version` major below HEAD's, an uncommitted foreign stamp, a failed fetch, or a
delivered-line refusal.

## Version rule: sticky major

The script never changes the major on its own. `N` is the major of HEAD's committed native files (Android and iOS
must agree on it).

- `dev` stamps `N.9.p`, where `p` is 1 + the highest `p` of any `N.9.p` in history, or `9` when major `N` has no dev
  build yet.
- `prod` stamps `N.0.0`. When HEAD is already `N.0.0`, that is a rebuild with new build numbers.
- Each build number (`CURRENT_PROJECT_VERSION`, `versionCode`) is 1 + the highest value in history for that
  platform. Every real run stamps new build numbers.
- History is every commit on local branches and `origin/*` that touches either native file, read after
  `git fetch origin`. Other refs are ignored.
- `--version x.y.z` stamps the value as given. A major below HEAD's major, or below the delivered major (next
  section), exits 2.

**Delivered line.** `origin/main` (read as `refs/remotes/origin/main`) is what ships to the stores. Play accepts any
`versionName`, so a downgraded or re-stamped marketing version would ship without any store error. Only the delivered
line counts: an undelivered higher major on a parallel release branch never blocks this one.

- **Behind the delivered major.** When `origin/main`'s major (on either platform) is above HEAD's, plain `dev` and
  plain `prod` both exit 2: merge the integration branch into this branch first, or pass `--version`.
- **Plain `prod` at or below the delivered version.** A derived version numerically less than or equal to the
  marketing version on `origin/main` (either platform) exits 2.
- **`--version` floor.** A `--version` whose major is below HEAD's major or the delivered major exits 2. The
  delivered `N.0.0` itself (a confirmed rebuild) and `<N+1>.0.0` pass.
- **Fail closed.** Plain `prod` also exits 2 when `origin/main` does not exist, or when a native file at the app's
  path is missing there or has no parseable version lines; the refusal names each file and its cause. `--version`
  proceeds, and `dev` is unaffected.
- **Unreadable delivered version.** A marketing version on `origin/main` that is not `x.y.z` is skipped when taking
  the delivered major from the other platform. When neither platform's version is `x.y.z`, plain `dev` and plain
  `prod` both exit 2; `--version` proceeds with a one-line notice that it was not checked against the delivered line.
- **Higher prod stamp elsewhere (plain `prod` only).** When any branch in history holds a committed `M.0.0` with `M`
  above HEAD's major, plain `prod` exits 2 and names the commit: that version may have reached the stores before
  `origin/main`, and Play would accept the lower one. Merge that line first, or pass `--version`. Plain `dev` is
  unaffected, so parallel release branches keep building dev builds.

A plain `prod` refusal prints both ways forward:

```text
Start the next major:   pnpm run build-native-prod --version 11.0.0
Rebuild 10.0.0 anyway:  pnpm run build-native-prod --version 10.0.0
```

Starting a new major is the one decision a human makes per release cycle. Every dry run prints it, based on the
higher of HEAD's major and the `--version` being stamped:

```text
next major: pnpm run build-native-prod --version <N+1>.0.0
```

`--version <N+1>.9.9` starts the new major with a dev build instead. Once the stamp is committed, the major is
sticky again.

**Uncommitted stamps.** The derivation reads committed state only. Before writing, each native file in the working
tree must hold either HEAD's version lines (it is stamped) or this run's computed stamp (a re-run; nothing is
written). Anything else exits 2: commit the earlier stamp if that build was uploaded, otherwise
`git checkout -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj`.

## Hand-off

The script does not commit, because it cannot know whether the build was uploaded. A successful run ends with:

```text
review `git diff -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj` first: `cap sync` may have changed more than the version lines
git commit -m "[APP] Stamp <app> <version> for the <env> native build (Android <code>, iOS build <build>)" -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj
```

Run that commit after uploading. App Store Connect and Play Console reject a reused build number at upload, which
is the final guard for uploads that were never committed.
