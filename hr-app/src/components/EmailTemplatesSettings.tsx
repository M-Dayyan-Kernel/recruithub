import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Loader2, Mail, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { EmailTemplatesResponse } from '@/types/api'
import { WORKFLOW_CARD_CLASS, WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'

const TEMPLATE_LABELS: Record<string, string> = {
  failed_screening_attempt: 'Failed Screening Attempt',
  interview_invitation: 'Interview Invitation',
  interview_reschedule: 'Interview Reschedule',
  rejection: 'Rejection',
}

export function EmailTemplatesSettings() {
  const queryClient = useQueryClient()
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
  const [bodyHtml, setBodyHtml] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  const activeTemplate = data?.templates[activeId]

  useEffect(() => {
    if (!activeTemplate) return
    setSubject(activeTemplate.subject)
    setBodyHtml(activeTemplate.body_html)
    setPreview(null)
    setDirty(false)
  }, [activeId, activeTemplate])

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

  if (isLoading || !data) {
    return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  }

  return (
    <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800">Email Templates</h3>
        <p className="mt-1 text-sm text-slate-500">
          Edit subject and body for automated emails. Required placeholders cannot be removed.
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

      <p className="mb-3 text-xs text-slate-500">
        Required placeholders: {requiredPlaceholders.join(', ')}
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Subject</label>
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
          <label className="mb-1 block text-xs font-medium text-slate-600">Body (HTML)</label>
          <textarea
            value={bodyHtml}
            onChange={(e) => {
              setBodyHtml(e.target.value)
              setDirty(true)
            }}
            rows={12}
            className={`${WORKFLOW_INPUT_CLASS} font-mono text-xs`}
          />
        </div>
      </div>

      {preview && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-600">Preview</p>
          <p className="mt-2 text-sm font-medium text-slate-800">{preview.subject}</p>
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
