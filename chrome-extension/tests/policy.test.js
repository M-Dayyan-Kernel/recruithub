import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parsePolicy } from '../policy.js'

const rules = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'default-rules.json'), 'utf8'),
)
const good = () => ({
  version: 3,
  mode: 'shadow',
  blocklist: [{ id: 'ABC'.padEnd(32, 'a'), name: 'Monica', category: 'ai_assistant', reason: 'AI', listing_url: null }],
  rules: structuredClone(rules),
})
const reason = (raw) => {
  const r = parsePolicy(raw)
  assert.equal(r.ok, false)
  return r.reason
}

test('a valid policy is accepted and normalised', () => {
  const r = parsePolicy(good())
  assert.equal(r.ok, true)
  assert.equal(r.policy.version, 3)
  assert.equal(r.policy.blocklist[0].id, 'abc'.padEnd(32, 'a'), 'ids are lower-cased')
})

test('the real default rules parse', () => {
  assert.equal(parsePolicy({ ...good(), rules }).ok, true)
})

test('non-objects, bad versions and bad modes are rejected', () => {
  for (const bad of [null, 'x', 5, [], undefined]) assert.equal(parsePolicy(bad).ok, false)
  assert.match(reason({ ...good(), version: -1 }), /version/)
  assert.match(reason({ ...good(), version: 1.5 }), /version/)
  assert.match(reason({ ...good(), mode: 'strict' }), /mode/)
})

test('oversized or malformed lists are rejected, never partially used', () => {
  const tooMany = { ...good(), blocklist: Array.from({ length: 2001 }, () => good().blocklist[0]) }
  assert.match(reason(tooMany), /blocklist/)
  assert.match(reason({ ...good(), blocklist: [{ id: 5, name: 'x' }] }), /blocklist entry/)
  assert.match(reason({ ...good(), blocklist: 'nope' }), /blocklist/)
})

test('rule sections must be present and well formed', () => {
  const noIntent = good(); delete noIntent.rules.intent
  assert.match(reason(noIntent), /rules/)

  const badKeyword = good(); badKeyword.rules.intent.keywords = [{ term: 'ai', weight: 99 }]
  assert.match(reason(badKeyword), /keyword/)

  const manyKeywords = good()
  manyKeywords.rules.intent.keywords = Array.from({ length: 201 }, (_, i) => ({ term: `t${i}`, weight: 1 }))
  assert.match(reason(manyKeywords), /keywords/)

  const badPerm = good(); badPerm.rules.capability.permissions = { tabCapture: -1 }
  assert.match(reason(badPerm), /permission weight/)
})

test('thresholds must be integers and ordered', () => {
  const t = good(); t.rules.thresholds.intent_strong = 'high'
  assert.match(reason(t), /intent_strong/)
  const o = good(); o.rules.thresholds.intent_weak = 9; o.rules.thresholds.intent_strong = 4
  assert.match(reason(o), /weak threshold/)
})
