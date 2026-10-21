import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exercises scripts/package.sh, the one implementation behind the zip that the
// candidate app serves for sideloading. It needs `zip` and `unzip`; without them
// (a bare CI image) the tests skip rather than fail.

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const have = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0
const skip = !have('zip') || !have('unzip') ? 'zip/unzip not installed' : false

function build() {
  const out = mkdtempSync(join(tmpdir(), 'rh-pkg-'))
  const run = spawnSync('sh', [join(root, 'scripts/package.sh'), root, out], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const entries = spawnSync('unzip', ['-Z1', join(out, 'rh-interview-check.zip')], { encoding: 'utf8' })
    .stdout.split('\n').filter((e) => e && !e.endsWith('/'))
  return { out, entries }
}

test('zip has the manifest at its root, so Windows extraction does not nest it', { skip }, () => {
  const { out, entries } = build()
  try {
    assert.ok(entries.includes('manifest.json'), `entries: ${entries.join(', ')}`)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('zip ships every file the manifest and its imports need, and no dev files', { skip }, () => {
  const { out, entries } = build()
  try {
    const shipped = new Set(entries)
    const needed = [manifest.background.service_worker, manifest.action.default_popup]
    for (const file of needed) assert.ok(shipped.has(file), `${file} missing from the zip`)

    // Follow relative imports so a new module that gets denied by mistake fails here,
    // not on a candidate's machine as an extension that will not load.
    const queue = [...shipped].filter((f) => f.endsWith('.js') || f.endsWith('.html'))
    for (const file of queue) {
      const src = readFileSync(join(root, file), 'utf8')
      for (const m of src.matchAll(/(?:from\s+|import\s+|src=)["'](\.\.?\/[^"']+)["']/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[1]))
        assert.ok(shipped.has(target), `${file} imports ${target}, which is not in the zip`)
      }
    }

    for (const entry of entries) {
      assert.ok(!/^(tests|scripts|dist|node_modules)\//.test(entry), `dev file shipped: ${entry}`)
      assert.ok(!['README.md', 'package.json'].includes(entry), `dev file shipped: ${entry}`)
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('descriptor matches the manifest version and the zip bytes', { skip }, () => {
  const { out } = build()
  try {
    const descriptor = JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'))
    const zip = readFileSync(join(out, 'rh-interview-check.zip'))
    assert.equal(descriptor.version, manifest.version)
    assert.equal(descriptor.file, 'rh-interview-check.zip')
    assert.equal(descriptor.bytes, statSync(join(out, 'rh-interview-check.zip')).size)
    assert.equal(descriptor.sha256, createHash('sha256').update(zip).digest('hex'))
    assert.deepEqual(readdirSync(out).sort(), ['latest.json', 'rh-interview-check.zip'])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
