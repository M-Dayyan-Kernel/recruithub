// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  htmlToPlainText,
  humanizePlaceholders,
  placeholderLabel,
  plainTextToHtml,
  previewDocument,
} from '../src/lib/emailTemplateText.ts'

// The interview-scheduled default, as the backend ships it: it has its own <style> block.
const SCHEDULED_DEFAULT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Interview Scheduled</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f7; }
    .slot { background: #f5f3ff; border-left: 4px solid #7c3aed; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Your interview is scheduled</h1>
    <p>Hi <strong>{{candidate_name}}</strong>,</p>
    <p>
      You have been scheduled for an AI-powered video interview for the
      <strong>{{job_title}}</strong> role.
    </p>
    <div class="slot">
      <strong>Please attend at:</strong><br />
      {{scheduled_at}}
    </div>
    <a href="{{interview_url}}" class="btn">Open interview link</a>
    <p style="word-break: break-all;">{{interview_url}}</p>
  </div>
</body>
</html>`

test('a template with its own <style> and <title> shows only the message, not the CSS', () => {
  const text = htmlToPlainText(SCHEDULED_DEFAULT)
  assert.ok(!/font-family|background|border-left|#7c3aed|Interview Scheduled\n/.test(text), text)
  // A CSS rule looks like `selector { property:`; a {{placeholder}} must not trip this.
  assert.ok(!/[.#a-z]+\s*\{\s*[a-z-]+\s*:/i.test(text), text)
  assert.match(text, /^Your interview is scheduled\n/)
  assert.match(text, /Hi \{\{candidate_name\}\},/)
})

test('indented source does not become indented text, and paragraphs stay paragraphs', () => {
  const text = htmlToPlainText(SCHEDULED_DEFAULT)
  for (const line of text.split('\n')) assert.equal(line, line.trim(), JSON.stringify(line))
  assert.match(
    text,
    /You have been scheduled for an AI-powered video interview for the \{\{job_title\}\} role\./,
  )
  assert.doesNotMatch(text, /\n{3,}/)
})

test('a <br> inside a block is a line break, not a paragraph break', () => {
  const text = htmlToPlainText(SCHEDULED_DEFAULT)
  assert.match(text, /Please attend at:\n\{\{scheduled_at\}\}/)
})

test('a button label and the line after it do not run together', () => {
  const text = htmlToPlainText(SCHEDULED_DEFAULT)
  assert.match(text, /Open interview link\n\{\{interview_url\}\}$/)
})

test('the plain-text editor round-trips: text -> html -> text', () => {
  const written = [
    'Hi {{candidate_name}},',
    'Your interview for {{job_title}} is on {{scheduled_at}}.\nPlease join here:',
    '{{interview_url}}',
    'Good luck!',
  ].join('\n\n')
  assert.equal(htmlToPlainText(plainTextToHtml(written)), written)
})

test('plain text is escaped on the way to HTML, and the interview link is made clickable', () => {
  const html = plainTextToHtml('Hi <b>{{candidate_name}}</b> & co\n\n{{interview_url}}')
  assert.ok(html.includes('&lt;b&gt;{{candidate_name}}&lt;/b&gt; &amp; co'))
  assert.ok(html.includes('<a href="{{interview_url}}">{{interview_url}}</a>'))
  assert.ok(!html.includes('<b>'))
})

test('stored HTML entities read as the characters they stand for', () => {
  assert.equal(htmlToPlainText('<p>Tom &amp; Jerry&nbsp;&lt;3 &quot;hi&quot; it&#39;s</p>'), 'Tom & Jerry <3 "hi" it\'s')
  assert.equal(htmlToPlainText('   '), '')
})

test('placeholders have friendly names, and unknown ones still read sensibly', () => {
  assert.equal(placeholderLabel('{{scheduled_at}}'), 'Interview date & time')
  assert.equal(placeholderLabel('{{offer_deadline}}'), 'offer deadline')
  assert.equal(
    humanizePlaceholders('Interview on {{scheduled_at}} for {{job_title}}'),
    'Interview on [Interview date & time] for [Job title]',
  )
})

test('preview documents get a base target so links cannot navigate the frame', () => {
  assert.match(previewDocument('<html><head><title>t</title></head><body>x</body></html>'), /<head><base target="_blank">/)
  assert.match(previewDocument('<!DOCTYPE html><html lang="en"><body>x</body></html>'), /<html lang="en"><head><base target="_blank"><\/head>/)
  const wrapped = previewDocument('<p>just a fragment</p>')
  assert.match(wrapped, /<base target="_blank">/)
  assert.match(wrapped, /<body><p>just a fragment<\/p><\/body>/)
})
