# Understanding `boundaries.test.ts`

## What this test file is actually checking

`boundaries.test.ts` verifies an **ESLint architectural rule** (`boundaries/dependencies`).
It doesn't test app code — it lints a tiny fake project under `__tests__/fixtures-p2/src/`
and checks that the rule *flags* the bad imports and *allows* the good ones.

The "project" has three kinds of folders:

- `features/alpha`, `features/beta` — sibling **features**
- `services/email`, `services/sms` — sibling **services**
- `shared/` — a common layer everyone is allowed to use

The policy being enforced (stated in the comment at the top of the test file):

> Sibling → sibling imports (feature↔feature, service↔service) must be **type-only**.
> The `shared` layer is the one runtime exception, and only **through its barrel**.

## The vocabulary in the test titles

Every title is `flags …` (= must be rejected) or `allows …` (= must be permitted).
The other words are jargon:

| Word in title        | What it means                                                        | Concrete example                                       |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| **runtime** import   | A *value* import — pulls real code that exists when the program runs | `import { thing } from '../alpha'`                     |
| **type-only** import | `import type …` — erased by the compiler, no runtime dependency      | `import type { Thing } from '../alpha/internal/thing'` |
| **cross-feature**    | beta importing from alpha (sibling → sibling)                       | `features/beta` → `features/alpha`                     |
| **cross-service**    | sms importing from email                                            | `services/sms` → `services/email`                      |
| **barrel**           | the folder's `index.ts` (its public entry point)                    | `from '../alpha'` resolves to `alpha/index.ts`         |
| **internals** / **deep import** | reaching *past* the barrel into a private file           | `from '../alpha/internal/thing'`                       |
| **shared layer**     | the `shared/` folder                                                | `from '../../shared'`                                  |

## "from" — the two places you see it

`from` shows up in two unrelated spots:

1. **In the import statement** — standard JS syntax: `import { thing } from '../alpha'`.
   The string after `from` is the *source path*, and that path is exactly what the rule
   inspects (is it a sibling? the barrel? an internal file?).

2. **In `export const fromAlpha = ...`** — here `fromAlpha` is just a **variable name** the
   fixture author chose ("the thing that came from alpha"). It has no special meaning; it's
   only there so the file has a valid export.

## Reading three titles end-to-end

- **"flags a runtime cross-feature import through the barrel"** → `uses-alpha-barrel.ts` does
  `import { thing } from '../alpha'`. A real (runtime) value import from a sibling feature,
  even via the barrel → **must be rejected**. `expectFlagged` asserts the rule fired.

- **"allows a type-only cross-feature import"** → `uses-alpha-internal-type.ts` does
  `import type { Thing } from '../alpha/internal/thing'`. Sibling, but type-only → erased at
  runtime → **allowed**. `expectClean` asserts no warning.

- **"flags a runtime deep import into shared (barrel only)"** → `uses-shared-deep.ts` does
  `import { sharedUtil } from '../../shared/util'`. Shared is allowed, but only through
  `shared/index.ts`; reaching into `shared/util` directly → **rejected**.

So a title reads as:
**[flags/allows] a [runtime/type-only] [cross-feature/cross-service/shared] import [via barrel / into internals]**
— and each one maps 1:1 to a fixture file whose import line is the thing under test.
