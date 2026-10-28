// Run with: npm test
//
// Renders every report with react-pdf, in Node, from the fixtures: the one place the components
// and fonts are exercised outside a browser. The layout and the wording are checked by the
// view-model tests and by reading the output (set PDF_SMOKE_KEEP=1 to keep the PDFs and look).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSmoke, type Smoke } from './pdf/buildSmoke.ts'

let smoke: Smoke
let rendered: Map<string, Buffer>

before(async () => {
  smoke = await buildSmoke()
  rendered = new Map((await smoke.renderAll()).map((r) => [r.name, r.buffer]))
  if (process.env.PDF_SMOKE_KEEP) {
    const dir = resolve('node_modules/.cache/pdf-smoke/kept')
    mkdirSync(dir, { recursive: true })
    for (const [name, buffer] of rendered) writeFileSync(resolve(dir, `${name}.pdf`), buffer)
  }
}, { timeout: 90_000 })

/** Counts page objects: "/Type /Page" but not "/Type /Pages". */
function pageCount(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
}

test('every report renders to a PDF', () => {
  assert.deepEqual([...rendered.keys()].sort(), [
    'interview-clean-hindi',
    'interview-failed',
    'interview-full',
    'interview-legacy',
    'interview-pending',
    'screening-full',
    'screening-minimal',
    'shortlist-bundle',
    'shortlist-single',
  ])
  for (const [name, buffer] of rendered) {
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-', name)
    assert.ok(buffer.length > 3_000, `${name} has content`)
  }
})

test('reports stay compact: no page-per-card sprawl', () => {
  assert.ok(pageCount(rendered.get('interview-full')!) <= 4, 'full interview report')
  assert.ok(pageCount(rendered.get('interview-clean-hindi')!) <= 3, 'clean interview report')
  assert.equal(pageCount(rendered.get('interview-legacy')!), 1)
  assert.equal(pageCount(rendered.get('screening-full')!), 1)
  assert.equal(pageCount(rendered.get('shortlist-single')!), 1)
})

test('the bulk export is a cover page plus one page per candidate', () => {
  assert.equal(pageCount(rendered.get('shortlist-bundle')!), 1 + 5)
})

test('Hindi text embeds the Devanagari font, and an English-only report does not', () => {
  const has = (name: string, font: string) => rendered.get(name)!.toString('latin1').includes(font)
  assert.ok(has('interview-clean-hindi', 'NotoSansDevanagari'))
  assert.ok(!has('interview-legacy', 'NotoSansDevanagari'))
})

test('a large bundle lays out in a reasonable time', async () => {
  const { ms } = await smoke.timeBundle(50)
  assert.ok(ms < 15_000, `50 candidates took ${ms} ms`)
}, { timeout: 60_000 })
