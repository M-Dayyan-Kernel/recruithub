// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COLORS } from '../src/lib/pdf/theme.ts'

// theme.ts copies the product's light-theme tokens as hex (react-pdf cannot read CSS variables).
// This keeps the two from drifting apart.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

function channels(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`))
  assert.ok(match, `--${name} is defined as three channels in tokens.css`)
  return '#' + match.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
}

test('the PDF theme matches the product tokens', () => {
  assert.equal(COLORS.ink, channels('ink-900'))
  assert.equal(COLORS.ink700, channels('ink-700'))
  assert.equal(COLORS.inkMuted, channels('ink-500'))
  assert.equal(COLORS.inkSubtle, channels('ink-300'))
  assert.equal(COLORS.line, channels('line-100'))
  assert.equal(COLORS.lineStrong, channels('line-200'))
  assert.equal(COLORS.pos, channels('pos-600'))
  assert.equal(COLORS.posSoft, channels('pos-50'))
  assert.equal(COLORS.warn, channels('warn-600'))
  assert.equal(COLORS.warnSoft, channels('warn-50'))
  assert.equal(COLORS.neg, channels('neg-600'))
  assert.equal(COLORS.negSoft, channels('neg-50'))
})
