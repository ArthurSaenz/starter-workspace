import { describe, it } from 'vitest'

import { code, expectClean, expectFlagged, lintCase } from './_lint-case.js'

// Behavioral coverage for the component exemption in src/configs/docs.ts. The content rules
// (require-description / require-example) only inspect ALREADY-documented nodes, so every fixture
// carries a description-less, example-less block — that is what makes the assertions non-vacuous:
// without a block the rules would skip the node regardless of the PascalCase contexts. Each exempt
// case is paired with a same-shape lowercase control so the ONLY difference is the name, proving the
// PascalCase negation in NON_COMPONENT_FN_CONTEXTS is what's acting. Fixtures live at non-excluded
// virtual paths (not *.test/*.spec/*.stories/__tests__/*.d.ts) so the JSDoc layer applies.

const REQUIRE_DESC = 'jsdoc/require-description'
const REQUIRE_EXAMPLE = 'jsdoc/require-example'
const REQUIRE_JSDOC = 'jsdoc/require-jsdoc'

const DESC_MSG = 'block description'
const EXAMPLE_MSG = '@example'
const JSDOC_MSG = 'Missing JSDoc'

// A description-less, example-less JSDoc block: present (so the content rules engage) but carrying
// neither a body description nor an @example — the minimal "documented but bare" shape.
const BARE_BLOCK = '/**\n * @public\n */'

describe('jsdoc: PascalCase components are exempt from require-description/require-example', () => {
  it('A: arrow component with a bare block — description/example/jsdoc all clean', async () => {
    const messages = await lintCase({
      fileName: 'src/components/widget.tsx',
      source: code`
        ${BARE_BLOCK}
        export const Widget = () => 1
      `,
    })

    expectClean(messages, REQUIRE_DESC)
    expectClean(messages, REQUIRE_EXAMPLE)
    expectClean(messages, REQUIRE_JSDOC)
  })

  it("A': lowercase arrow with the same bare block — description AND example fire", async () => {
    const messages = await lintCase({
      fileName: 'src/lib/helper.ts',
      source: code`
        ${BARE_BLOCK}
        export const helper = () => 1
      `,
    })

    expectFlagged(messages, REQUIRE_DESC, DESC_MSG)
    expectFlagged(messages, REQUIRE_EXAMPLE, EXAMPLE_MSG)
    expectClean(messages, REQUIRE_JSDOC)
  })

  it('B: function-declaration component with a bare block — description/example clean', async () => {
    const messages = await lintCase({
      fileName: 'src/components/widget.tsx',
      source: code`
        ${BARE_BLOCK}
        export function Widget() {
          return 1
        }
      `,
    })

    expectClean(messages, REQUIRE_DESC)
    expectClean(messages, REQUIRE_EXAMPLE)
  })

  it("B': lowercase function declaration with the same bare block — description AND example fire", async () => {
    const messages = await lintCase({
      fileName: 'src/lib/helper.ts',
      source: code`
        ${BARE_BLOCK}
        export function helper() {
          return 1
        }
      `,
    })

    expectFlagged(messages, REQUIRE_DESC, DESC_MSG)
    expectFlagged(messages, REQUIRE_EXAMPLE, EXAMPLE_MSG)
  })

  it('D: function-expression component with a bare block — description/example clean', async () => {
    const messages = await lintCase({
      fileName: 'src/components/widget.tsx',
      source: code`
        ${BARE_BLOCK}
        export const Widget = function () {
          return 1
        }
      `,
    })

    expectClean(messages, REQUIRE_DESC)
    expectClean(messages, REQUIRE_EXAMPLE)
  })

  it("D': lowercase function expression with the same bare block — description AND example fire", async () => {
    const messages = await lintCase({
      fileName: 'src/lib/helper.ts',
      source: code`
        ${BARE_BLOCK}
        export const helper = function () {
          return 1
        }
      `,
    })

    expectFlagged(messages, REQUIRE_DESC, DESC_MSG)
    expectFlagged(messages, REQUIRE_EXAMPLE, EXAMPLE_MSG)
  })

  it('C: block-less >15-line component — require-jsdoc fires, description/example stay silent', async () => {
    const messages = await lintCase({
      fileName: 'src/components/widget.tsx',
      source: code`
        export const BigWidget = () => {
          const a01 = 1
          const a02 = 2
          const a03 = 3
          const a04 = 4
          const a05 = 5
          const a06 = 6
          const a07 = 7
          const a08 = 8
          const a09 = 9
          const a10 = 10
          const a11 = 11
          const a12 = 12
          const a13 = 13
          const a14 = 14
          const a15 = 15
          const a16 = 16

          return a01 + a02 + a03 + a04 + a05 + a06 + a07 + a08 + a09 + a10 + a11 + a12 + a13 + a14 + a15 + a16
        }
      `,
    })

    expectFlagged(messages, REQUIRE_JSDOC, JSDOC_MSG)
    expectClean(messages, REQUIRE_DESC)
    expectClean(messages, REQUIRE_EXAMPLE)
  })
})
