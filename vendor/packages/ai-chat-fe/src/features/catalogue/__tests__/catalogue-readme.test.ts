import { describe, expect, it } from 'vitest'

import readme from '../../../../readme.md?raw'
import { FEATURES, renderCatalogueMarkdown } from '../services/main.js'

const START = '<!-- catalogue:start -->'
const END = '<!-- catalogue:end -->'

// prettier re-aligns the table columns (and stretches the `---` separators) when the script writes
// the block, so the comparison is cell-trimmed on both sides.
const normalise = (markdown: string): string[] => {
  return markdown
    .trim()
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|')) return line.trim()

      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => {
          return cell.trim().replace(/^-{3,}$/, '---')
        })

      return `| ${cells.join(' | ')} |`
    })
}

describe('readme catalogue block', () => {
  it('is the registry rendered by scripts/render-catalogue.mjs', () => {
    const start = readme.indexOf(START)
    const end = readme.indexOf(END)

    expect(start, 'missing catalogue:start marker').toBeGreaterThan(-1)
    expect(end, 'missing catalogue:end marker').toBeGreaterThan(start)

    const block = readme.slice(start + START.length, end)

    expect(normalise(block)).toEqual(normalise(renderCatalogueMarkdown(FEATURES)))
  })
})
