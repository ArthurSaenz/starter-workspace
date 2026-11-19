# @wl/native-build

One-shot native build for a Capacitor app: stamp the version into `android/app/build.gradle` and
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
pnpm run build-native-dev --version 10.9.9 --dry-run
```

| Element                      | Required | Meaning                                                                     |
| ---------------------------- | -------- | --------------------------------------------------------------------------- |
| `dev` \| `prod`              | yes      | the target environment                                                      |
| `--domain <https-url>`       | yes      | the MFE origin the bundle loads; set in the consumer script                 |
| `--version <x.y.z>`          | yes      | the marketing version to stamp                                              |
| `--dry-run`                  | no       | print the plan; write and run nothing                                       |
| `--help`                     | no       | show the usage                                                              |
| env `VITE_MOBILE_DOMAIN_URL` | —        | must have the same origin as `--domain` when set, otherwise the run exits 2 |
| env `DEVELOPER_DIR`          | —        | set for `cap sync` when `/Applications/Xcode.app` exists                    |

For a one-off domain, such as a preview environment, call the bin directly:

```sh
pnpm exec wl-native-build dev --domain <preview-url> --version 10.9.9
```

A non-zero `cap sync` exit is only a warning: its final `xcodebuild clean` can fail after the copy and pod install
are done. The build then passes only if both synced bundles reference `<domain>/mfe/remoteEntry.js`.

Exit codes: `0` success, `1` build or bundle-assertion failure, `2` usage error or contract violation.
