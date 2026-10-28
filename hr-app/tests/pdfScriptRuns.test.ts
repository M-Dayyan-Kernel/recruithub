// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasDevanagari, splitByScript } from '../src/lib/pdf/scriptRuns.ts'

test('plain English is one Latin run', () => {
  assert.deepEqual(splitByScript('Senior Frontend Engineer, 5+ years'), [
    { text: 'Senior Frontend Engineer, 5+ years', script: 'latin' },
  ])
})

test('Hindi is its own run, so it can be set in a font that has the glyphs', () => {
  assert.deepEqual(splitByScript('राहुल शर्मा'), [{ text: 'राहुल शर्मा', script: 'devanagari' }])
})

test('mixed text splits at the script change, with spaces joining the run before them', () => {
  const runs = splitByScript('Rahul राहुल शर्मा – Engineer')
  assert.deepEqual(
    runs.map((r) => r.script),
    ['latin', 'devanagari', 'latin'],
  )
  assert.equal(runs.map((r) => r.text).join(''), 'Rahul राहुल शर्मा – Engineer')
})

test('digits and punctuation do not start their own runs', () => {
  const runs = splitByScript('12/34 राहुल (56%)')
  assert.equal(runs.map((r) => r.text).join(''), '12/34 राहुल (56%)')
  assert.ok(runs.length <= 3)
  assert.equal(runs[0].script, 'latin')
})

test('joiners that shape conjuncts stay inside the Devanagari run', () => {
  const runs = splitByScript('क्‍ष')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].script, 'devanagari')
})

test('empty text has no runs, and detection is cheap', () => {
  assert.deepEqual(splitByScript(''), [])
  assert.equal(hasDevanagari('Hello'), false)
  assert.equal(hasDevanagari('नमस्ते'), true)
  assert.equal(hasDevanagari(null), false)
})
