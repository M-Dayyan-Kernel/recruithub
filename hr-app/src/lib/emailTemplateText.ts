/**
 * Plain-language editing of email templates.
 *
 * HR edits a message as plain text; the API stores simple HTML. These helpers convert
 * between the two and describe the placeholders (`{{candidate_name}}` and friends) in
 * words a recruiter would use. Pure functions, so they can be tested without a browser.
 */

export const PLACEHOLDER_LABELS: Record<string, string> = {
  '{{candidate_name}}': 'Candidate name',
  '{{job_title}}': 'Job title',
  '{{phone_number}}': 'Phone number',
  '{{interview_url}}': 'Interview link',
  '{{scheduled_at}}': 'Interview date & time',
  '{{deadline}}': 'Complete-by date & time',
  '{{company_name}}': 'Company name',
}

/** A token's wording, or the token itself for one this UI has no wording for yet. */
export function placeholderLabel(token: string): string {
  return PLACEHOLDER_LABELS[token] ?? token.replace(/[{}]/g, '').replace(/_/g, ' ')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/**
 * Turn stored email HTML into text HR can edit.
 *
 * Source formatting is collapsed first, as a mail client would, so indented HTML does
 * not turn into indented text. The head, styles, scripts and comments are dropped
 * outright: a template that carries its own `<style>` block (the interview-scheduled
 * default does) must not show its CSS as if it were the message.
 */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\s+/g, ' ')
    // An opening block tag starts a new line too, so a button label and the line after it
    // do not run together.
    .replace(/<(p|div|h[1-6]|li|tr|table)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/(div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert HR plain text back into simple email HTML for the API. */
export function plainTextToHtml(plain: string): string {
  const paragraphs = plain
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const body = paragraphs
    .map((block) => {
      const withBreaks = escapeHtml(block).replace(/\n/g, '<br />\n')
      // Turn a lone interview URL placeholder into a clickable link.
      const linked = withBreaks.replace(
        /\{\{interview_url\}\}/g,
        '<a href="{{interview_url}}">{{interview_url}}</a>',
      )
      return `<p>${linked}</p>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
${body}
</body>
</html>`
}

/** Show a rendered subject with its tokens in words, for places that never see real data. */
export function humanizePlaceholders(text: string): string {
  return Object.entries(PLACEHOLDER_LABELS).reduce(
    (acc, [token, label]) => acc.replaceAll(token, `[${label}]`),
    text,
  )
}

/**
 * A document for a sandboxed preview frame. `<base target="_blank">` makes a click on a
 * link try to open a new window, which the sandbox blocks, so a preview link does
 * nothing instead of loading the example address inside the preview.
 */
export function previewDocument(html: string): string {
  const base = '<base target="_blank">'
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}</head>`)
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`
}
