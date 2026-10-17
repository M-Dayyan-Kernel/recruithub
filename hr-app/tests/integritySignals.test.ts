import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSignal } from '../src/lib/integritySignals.ts'
import { validateExtensionId } from '../src/lib/validation.ts'

test('signals read as plain language', () => {
  assert.equal(describeSignal('keyword:chatgpt'), 'mentions "chatgpt"')
  assert.equal(describeSignal('host:openai.com'), 'can reach openai.com')
  assert.equal(describeSignal('homepage:claude.ai'), 'homepage on claude.ai')
  assert.equal(describeSignal('permission:tabCapture'), 'can capture tab audio and video')
  assert.equal(describeSignal('broad_host'), 'can run on every website')
  assert.match(describeSignal('cannot_be_disabled'), /device policy/)
})

test('unknown signals are shown as they are, not hidden or invented', () => {
  assert.equal(describeSignal('permission:somethingNew'), 'permission somethingNew')
  assert.equal(describeSignal('brand_new_signal'), 'brand_new_signal')
})

test('a signal value containing a colon is kept whole', () => {
  assert.equal(describeSignal('keyword:ai: assistant'), 'mentions "ai: assistant"')
})

test('extension id validation matches the Chrome Web Store format', () => {
  assert.equal(validateExtensionId('ofpnmcalabcbjgholdjcjblkibolbppb'), null)
  assert.equal(validateExtensionId('  OFPNMCALABCBJGHOLDJCJBLKIBOLBPPB '), null)
  assert.ok(validateExtensionId(''))
  assert.ok(validateExtensionId('short'))
  assert.ok(validateExtensionId('z'.repeat(32)))
  assert.ok(validateExtensionId('1'.repeat(32)))
})
