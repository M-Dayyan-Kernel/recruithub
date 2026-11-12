// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatFileSize, jdPreviewKind } from '../src/lib/jdPreview.ts'

test('a PDF is previewed as a document, anything else as text', () => {
  assert.equal(jdPreviewKind({ name: 'jd.pdf', type: 'application/pdf' }), 'pdf')
  assert.equal(jdPreviewKind({ name: 'JD.PDF', type: '' }), 'pdf')
  assert.equal(jdPreviewKind({ name: 'jd.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'text')
  assert.equal(jdPreviewKind({ name: 'jd.doc' }), 'text')
})

test('file sizes read as people say them', () => {
  assert.equal(formatFileSize(500), '500 B')
  assert.equal(formatFileSize(860 * 1024), '860 KB')
  assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.5 MB')
  assert.equal(formatFileSize(-1), '')
})
