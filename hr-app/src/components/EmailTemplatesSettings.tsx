import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Loader2, Mail, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { EmailTemplatesResponse } from '@/types/api'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
} from '@/lib/workflow'

const TEMPLATE_LABELS: Record<string, string> = {
  failed_screening_attempt: 'Failed Screening Attempt',
  interview_invitation: 'Interview Invitation',
  interview_reschedule: 'Interview Reschedule',
  rejection: 'Rejection',
}

const PLACEHOLDER_LABELS: Record<string, string> = {
  '{{candidate_name}}': 'Candidate name',
  '{{job_title}}': 'Job title',
  '{{phone_number}}': 'Phone number',
  '{{interview_url}}': 'Interview link',
  '{{company_name}}': 'Company name',
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

/** Convert stored email HTML into editable plain text for HR. */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  let text = html
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
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

function humanizePlaceholders(text: string): string {
  return Object.entries(PLACEHOLDER_LABELS).reduce(
    (acc, [token, label]) => acc.replaceAll(token, `[${label}]`),
    text,
  )
}

export function EmailTemplatesSettings() {
  const queryClient = useQueryClient()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const { data, isLoading } = useQuery<EmailTemplatesResponse>({
    queryKey: ['email-templates'],
    queryFn: () =>
      api.get('/api/settings/email-templates') as unknown as Promise<EmailTemplatesResponse>,
  })

  const templateIds = useMemo(
    () => Object.keys(TEMPLATE_LABELS) as Array<keyof typeof TEMPLATE_LABELS>,
    [],
  )
  const [activeId, setActiveId] = useState<string>('failed_screening_attempt')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [companyDirty, setCompanyDirty] = useState(false)

  const activeTemplate = data?.templates[activeId]
  const bodyHtml = useMemo(() => plainTextToHtml(bodyText), [bodyText])

  useEffect(() => {
    if (!data) return
    setCompanyName(data.company_name || '')
    setCompanyDirty(false)
  }, [data?.company_name])

  useEffect(() => {
    if (!activeTemplate) return
    setSubject(activeTemplate.subject)
    setBodyText(htmlToPlainText(activeTemplate.body_html))
    setPreview(null)
    setDirty(false)
  }, [activeId, activeTemplate])

  const companyMutation = useMutation({
    mutationFn: () =>
      api.patch('/api/settings', {
        company_name: companyName.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Company name saved')
      setCompanyDirty(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save company name'),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/settings/email-templates/${activeId}`, {
        subject,
        body_html: bodyHtml,
      }) as unknown as Promise<EmailTemplatesResponse>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] })
      toast.success('Template saved')
      setDirty(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save template'),
  })

  const restoreMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/api/settings/email-templates/${activeId}/restore`,
      ) as unknown as Promise<EmailTemplatesResponse>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] })
      toast.success('Template restored to default')
      setDirty(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to restore template'),
  })

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/settings/email-templates/${activeId}/preview`, {
        subject,
        body_html: bodyHtml,
      }) as unknown as Promise<{ subject: string; body_html: string }>,
    onSuccess: (result) => setPreview(result),
    onError: (err: Error) => toast.error(err.message || 'Preview failed'),
  })

  const testMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/settings/email-templates/${activeId}/test`, {
        to_email: testEmail,
        subject,
        body_html: bodyHtml,
      }),
    onSuccess: () => toast.success(`Test email sent to ${testEmail}`),
    onError: (err: Error) => toast.error(err.message || 'Failed to send test email'),
  })

  const requiredPlaceholders = data?.required_placeholders[activeId] ?? []
  const insertTokens = useMemo(() => {
    const common = data?.common_placeholders ?? ['{{company_name}}']
    return Array.from(new Set([...common, ...requiredPlaceholders]))
  }, [data?.common_placeholders, requiredPlaceholders])

  const insertPlaceholder = (token: string) => {
    const el = bodyRef.current
    if (!el) {
      setBodyText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`)
      setDirty(true)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = `${bodyText.slice(0, start)}${token}${bodyText.slice(end)}`
    setBodyText(next)
    setDirty(true)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  if (isLoading || !data) {
    return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  }

  return (
    <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800">Email Templates</h3>
        <p className="mt-1 text-sm text-slate-500">
          Write emails in plain language. Use the buttons below to insert candidate details — no
          HTML needed.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="mb-1 block text-xs font-medium text-slate-600">Company name</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={companyName}
            onChange={(e) => {
              setCompanyName(e.target.value)
              setCompanyDirty(true)
            }}
            placeholder="e.g. Acme Corp"
            className={`${WORKFLOW_INPUT_CLASS} min-w-[220px] flex-1`}
          />
          <button
            type="button"
            onClick={() => companyMutation.mutate()}
            disabled={!companyName.trim() || companyMutation.isPending || !companyDirty}
            className={WORKFLOW_PRIMARY_BUTTON_CLASS}
          >
            {companyMutation.isPending ? 'Saving…' : 'Save company'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Used wherever you insert “Company name” in a template. Current value:{' '}
          <span className="font-medium text-slate-700">{data.company_name || '—'}</span>
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {templateIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
              setActiveId(id)
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              activeId === id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {TEMPLATE_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
        <p className="mb-2 text-xs font-medium text-slate-600">Insert into message</p>
        <div className="flex flex-wrap gap-1.5">
          {insertTokens.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => insertPlaceholder(token)}
              className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
            >
              + {PLACEHOLDER_LABELS[token] ?? token}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          These fields are filled in automatically when the email is sent. Keep them in the message.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Subject line</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              setDirty(true)
            }}
            className={WORKFLOW_INPUT_CLASS}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Message</label>
          <textarea
            ref={bodyRef}
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value)
              setDirty(true)
            }}
            rows={12}
            placeholder="Write the email message here…"
            className={`${WORKFLOW_INPUT_CLASS} text-sm leading-relaxed`}
          />
          <p className="mt-1.5 text-[11px] text-slate-400">
            Tip: leave a blank line between paragraphs. Preview below shows how it will look to the
            candidate.
          </p>
        </div>
      </div>

      {preview && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-600">Candidate preview</p>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {humanizePlaceholders(preview.subject)}
          </p>
          <div
            className="prose prose-sm mt-3 max-w-none text-slate-700"
            dangerouslySetInnerHTML={{ __html: preview.body_html }}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {previewMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Eye size={14} />
          )}
          Preview
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className={WORKFLOW_PRIMARY_BUTTON_CLASS}
        >
          {saveMutation.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => restoreMutation.mutate()}
          disabled={restoreMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RotateCcw size={14} />
          Restore default
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Send test email</label>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="you@company.com"
            className={WORKFLOW_INPUT_CLASS}
          />
        </div>
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={!testEmail || testMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {testMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Mail size={14} />
          )}
          Send test
        </button>
      </div>
    </div>
  )
}
