import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

test('manifest is Manifest V3 with the management permission only', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ['management'])
})

test('manifest requests no host access, content scripts, or web-accessible resources', () => {
  for (const key of [
    'host_permissions',
    'optional_host_permissions',
    'optional_permissions',
    'content_scripts',
    'web_accessible_resources',
  ]) {
    assert.equal(manifest[key], undefined, `${key} must not be declared`)
  }
})

test('external messaging is limited to explicit Recruit Hub origins', () => {
  const { matches, ids, accepts_tls_channel_id: tls, ...rest } = manifest.externally_connectable
  assert.deepEqual(Object.keys(rest), [])
  assert.equal(ids, undefined, 'other extensions must not be able to connect')
  assert.ok(Array.isArray(matches) && matches.length > 0)
  for (const m of matches) {
    assert.match(m, /^https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9.-]+\.[a-z]{2,})\/\*$/, `broad pattern: ${m}`)
    assert.ok(!m.includes('*.') && m !== '<all_urls>')
  }
})

test('manifest pins a key so the extension ID is stable for the candidate app', () => {
  assert.equal(typeof manifest.key, 'string')
  assert.ok(manifest.key.length > 100)
})

test('service worker is a module (background.js uses ES imports) and files exist', () => {
  assert.equal(manifest.background.type, 'module')
  for (const file of [manifest.background.service_worker, manifest.action.default_popup]) {
    assert.ok(existsSync(join(root, file)), `${file} is missing`)
  }
})

test('popup loads its script as a module and uses no inline script', () => {
  const html = readFileSync(join(root, 'popup.html'), 'utf8')
  assert.match(html, /<script type="module" src="popup\.js">/)
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/)
})
