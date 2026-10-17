// Evaluation harness: how do the default rules fare on a labelled corpus?
//
// The corpus is approximate (see its _note), so this guards against regressions
// and makes tuning measurable; it is not proof of real-world accuracy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyInstalled } from '../classify.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const corpus = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'))
const rules = JSON.parse(readFileSync(join(dir, 'default-rules.json'), 'utf8'))

const policy = (mode) => ({ version: 1, mode, blocklist: [], rules })
const asInstalled = (items) =>
  items.map((e) => ({ ...e, enabled: true, type: 'extension', mayDisable: true }))

function outcomes(items, mode) {
  const found = new Map(classifyInstalled(asInstalled(items), policy(mode)).map((f) => [f.id, f]))
  return items.map((item) => ({ item, hit: found.get(item.id) ?? null }))
}

const pct = (n, d) => (d === 0 ? 0 : Math.round((100 * n) / d))

test('corpus is large enough and ids are unique', () => {
  assert.ok(corpus.ai.length >= 20)
  assert.ok(corpus.benign.length >= 25)
  const ids = [...corpus.ai, ...corpus.ai_adjacent, ...corpus.benign].map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('benign extensions are never blocked, in enforce mode', () => {
  const blocked = outcomes(corpus.benign, 'enforce').filter((o) => o.hit?.blocked)
  assert.deepEqual(blocked.map((o) => o.item.name), [])
})

test('benign extensions are never even marked strong', () => {
  const strong = outcomes(corpus.benign, 'shadow').filter((o) => o.hit?.would_block)
  assert.deepEqual(strong.map((o) => o.item.name), [])
})

test('benign false-flag rate stays low', () => {
  const flagged = outcomes(corpus.benign, 'shadow').filter((o) => o.hit)
  const rate = pct(flagged.length, corpus.benign.length)
  assert.ok(rate <= 10, `benign flagged ${rate}%: ${flagged.map((o) => o.item.name).join(', ')}`)
})

test('AI-adjacent tools (writing/meeting assistants) are never blocked', () => {
  const blocked = outcomes(corpus.ai_adjacent, 'enforce').filter((o) => o.hit?.blocked)
  assert.deepEqual(blocked.map((o) => o.item.name), [])
})

test('most unknown AI assistants are at least flagged', () => {
  const results = outcomes(corpus.ai, 'shadow')
  const missed = results.filter((o) => !o.hit).map((o) => o.item.name)
  const recall = pct(results.length - missed.length, results.length)
  assert.ok(recall >= 85, `recall ${recall}%, missed: ${missed.join(', ')}`)
})

test('a good share of unknown AI assistants would be blocked (strong)', () => {
  const results = outcomes(corpus.ai, 'shadow')
  const strong = results.filter((o) => o.hit?.would_block)
  const rate = pct(strong.length, results.length)
  assert.ok(rate >= 45, `strong rate ${rate}%: weak/missed = ${results.filter((o) => !o.hit?.would_block).map((o) => o.item.name).join(', ')}`)
})

test('shadow mode never blocks on a heuristic; enforce mode does', () => {
  const shadow = outcomes(corpus.ai, 'shadow').filter((o) => o.hit?.blocked)
  assert.equal(shadow.length, 0)
  const enforce = outcomes(corpus.ai, 'enforce').filter((o) => o.hit?.blocked)
  assert.ok(enforce.length > 0)
})

test('print the numbers for the record', () => {
  const ai = outcomes(corpus.ai, 'shadow')
  const benign = outcomes(corpus.benign, 'shadow')
  const adjacent = outcomes(corpus.ai_adjacent, 'shadow')
  console.log(
    `AI flagged ${pct(ai.filter((o) => o.hit).length, ai.length)}% | AI strong ${pct(
      ai.filter((o) => o.hit?.would_block).length, ai.length)}% | benign flagged ${pct(
      benign.filter((o) => o.hit).length, benign.length)}% | adjacent flagged ${pct(
      adjacent.filter((o) => o.hit).length, adjacent.length)}%`,
  )
})
