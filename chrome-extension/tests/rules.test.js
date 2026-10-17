import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hostMatchesVendor, hostOf, scoreExtension, verdictFor } from '../rules.js'

const rules = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'default-rules.json'), 'utf8'),
)
const score = (info) => scoreExtension(info, rules)

test('hostOf reads the host of match patterns and URLs', () => {
  assert.equal(hostOf('https://api.openai.com/*'), 'api.openai.com')
  assert.equal(hostOf('*://*.claude.ai/*'), '*.claude.ai')
  assert.equal(hostOf('http://LOCALHOST:5173/x'), 'localhost')
  assert.equal(hostOf('<all_urls>'), null)
  assert.equal(hostOf('storage'), null)
  assert.equal(hostOf(undefined), null)
})

test('vendor host matching is exact-or-subdomain, never a substring', () => {
  assert.equal(hostMatchesVendor('api.openai.com', 'openai.com'), true)
  assert.equal(hostMatchesVendor('*.openai.com', 'openai.com'), true)
  assert.equal(hostMatchesVendor('openai.com', 'openai.com'), true)
  assert.equal(hostMatchesVendor('notopenai.com', 'openai.com'), false)
  assert.equal(hostMatchesVendor('openai.com.evil.example', 'openai.com'), false)
  assert.equal(hostMatchesVendor('*', 'openai.com'), false)
  assert.equal(hostMatchesVendor(null, 'openai.com'), false)
})

test('keywords match whole words only', () => {
  assert.equal(score({ name: 'Email Tracker' }).intent_score, 0) // "ai" is inside "email"
  assert.equal(score({ name: 'Maid Cleaner' }).intent_score, 0)
  assert.ok(score({ name: 'AI Notes' }).intent_score >= 2)
})

test('a plural of a keyword still matches', () => {
  const s = score({ name: 'Interview Answers' })
  assert.ok(s.signals.includes('keyword:interview answer'))
})

test('each keyword counts once however often it appears', () => {
  const once = score({ description: 'chatgpt' }).intent_score
  const many = score({ description: 'chatgpt chatgpt chatgpt' }).intent_score
  assert.equal(once, many)
})

test('an AI vendor host in permissions raises intent and is recorded', () => {
  const s = score({ name: 'Helper', hostPermissions: ['https://api.openai.com/*'] })
  assert.ok(s.intent_score >= rules.intent.vendor_host_weight)
  assert.ok(s.signals.includes('host:openai.com'))
})

test('capability comes from declared permissions and broad host access', () => {
  const s = score({ permissions: ['tabCapture', 'sidePanel'], hostPermissions: ['<all_urls>'] })
  assert.equal(s.capability_score, 3 + 2 + rules.capability.broad_host_weight)
  assert.ok(s.signals.includes('broad_host'))
})

test('capability alone does not create intent', () => {
  const s = score({
    name: 'Password Manager',
    description: 'Keeps your logins safe',
    permissions: ['activeTab', 'scripting'],
    hostPermissions: ['<all_urls>'],
  })
  assert.equal(s.intent_score, 0)
  assert.equal(verdictFor(s, rules.thresholds), null)
})

test('verdict: strong needs both axes, weak is intent alone', () => {
  const t = rules.thresholds
  assert.equal(verdictFor({ intent_score: t.intent_strong, capability_score: t.capability_strong }, t), 'strong')
  assert.equal(verdictFor({ intent_score: t.intent_strong, capability_score: 0 }, t), 'weak')
  assert.equal(verdictFor({ intent_score: t.intent_weak, capability_score: 99 }, t), 'weak')
  assert.equal(verdictFor({ intent_score: t.intent_weak - 1, capability_score: 99 }, t), null)
})

test('missing fields never throw', () => {
  assert.doesNotThrow(() => score({}))
  assert.doesNotThrow(() => score({ name: null, permissions: null, hostPermissions: undefined }))
})
