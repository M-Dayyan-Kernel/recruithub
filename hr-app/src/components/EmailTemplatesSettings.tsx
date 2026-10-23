import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { EmailTemplatesResponse } from '@/types/api'
import { BTN_GHOST, BTN_PRIMARY, Badge, Card, INPUT } from '@/components/ui/Surface'
import {
  htmlToPlainText,
  placeholderLabel,
  plainTextToHtml,
  previewDocument,
} from '@/lib/emailTemplateText'

/**
 * What each template is and when it goes out, in the order a candidate meets them. Copy
 * only: the list itself comes from the API, so a template the backend adds shows up here
 * with a plain name even before anyone writes its line.
 */
const TEMPLATE_META: Record<string, { label: string; when: string }> = {
  failed_screening_attempt: {
    label: 'Missed screening call',
    when: 'Sent after a screening call could not reach the candidate.',
  },
  interview_invitation: {
    label: 'Interview invitation',
    when: 'Sent with the interview link when a candidate is invited to interview.',
  },
  interview_scheduled: {
    label: 'Interview scheduled',
    when: 'Sent when an interview is booked for a specific date and time.',
  },
  interview_reschedule: {
    label: 'Interview rescheduled',
    when: 'Sent with a new link when an interview is rescheduled.',
  },
  interview_cancelled: {
    label: 'Interview cancelled',
    when: 'Sent when an interview is cancelled and HR chooses to tell the candidate.',
  },
  rejection: {
    label: 'Rejection',
    when: 'Sent when a candidate is rejected from the shortlist.',
  },
}
const TEMPLATE_ORDER = Object.keys(TEMPLATE_META)

function metaFor(id: string) {
  return (
    TEMPLATE_META[id] ?? {
      label: id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      when: '',
    }
  )
}

/** INPUT fixes its height at h-11, which is right for a line and wrong for a message. */
const TEXTAREA =
  'block min-h-[22rem] w-full resize-y rounded-md border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft'

/** A value that follows `value` after it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

// ── Template tabs ────────────────────────────────────────────────────────────

/** One tab per email, in a row above the editor so the editor gets the full width. */
function TemplateTabs({
  ids,
  activeId,
  templates,
  onSelect,
}: {
  ids: string[]
  activeId: string
  templates: EmailTemplatesResponse['templates']
  onSelect: (id: string) => void
}) {
  return (
    <div role="tablist" aria-label="Email templates" className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const on = id === activeId
        const edited = (templates[id]?.version ?? 1) > 1
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tpl-tab-${id}`}
            aria-selected={on}
            aria-controls="tpl-panel"
            onClick={() => onSelect(id)}
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              on
                ? 'border-accent bg-accent-soft text-accent shadow-e1'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {metaFor(id).label}
            {edited && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-accent' : 'bg-ink-subtle'}`}
                title="Edited"
              >
                <span className="sr-only">Edited</span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The email as the candidate sees it, sized to its content so a short email does not sit in
 * a tall empty frame.
 *
 * Sandboxed with `allow-same-origin` but NOT `allow-scripts`: nothing in the stored HTML can
 * run, so it cannot reach this page, yet this page may read the frame's height. (That
 * combination is only dangerous together with allow-scripts, which is never granted.)
 */
function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

  const fit = () => {
    const frame = ref.current
    const doc = frame?.contentDocument
    if (!frame || !doc) return
    // scrollHeight never reports less than the frame's own height, so collapse it first.
    frame.style.height = '0px'
    const content = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0))
    frame.style.height = `${Math.min(Math.max(content, 120), 960)}px`
  }

  return (
    <iframe
      ref={ref}
      title="Email preview"
      sandbox="allow-same-origin"
      srcDoc={previewDocument(html)}
      onLoad={fit}
      className="block w-full bg-white"
      style={{ height: 240 }}
    />
  )
}

// ── Editor ───────────────────────────────────────────────────────────────────

export function EmailTemplatesSettings() {
  const queryClient = useQueryClient()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const { data, isLoading } = useQuery<EmailTemplatesResponse>({
    queryKey: ['email-templates'],
    queryFn: () =>
      api.get('/api/settings/email-templates') as unknown as Promise<EmailTemplatesResponse>,
  })

  const ids = useMemo(() => {
    const present = Object.keys(data?.templates ?? {})
    return [
      ...TEMPLATE_ORDER.filter((id) => present.includes(id)),
      ...present.filter((id) => !TEMPLATE_ORDER.includes(id)),
    ]
  }, [data?.templates])

  const [activeId, setActiveId] = useState<string>(TEMPLATE_ORDER[0])
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [testEmail, setTestEmail] = useState('')

  const activeTemplate = data?.templates[activeId]
  const baselineText = useMemo(
    () => (activeTemplate ? htmlToPlainText(activeTemplate.body_html) : ''),
    [activeTemplate],
  )
  const bodyChanged = bodyText !== baselineText
  const dirty = !!activeTemplate && (subject !== activeTemplate.subject || bodyChanged)

  // Only re-encode the message when it was edited. A template that carries its own
  // layout (the interview-scheduled default does) would otherwise be flattened to plain
  // paragraphs by a save, a preview or a test send that changed nothing in the message.
  const bodyHtml = useMemo(
    () => (bodyChanged || !activeTemplate ? plainTextToHtml(bodyText) : activeTemplate.body_html),
    [bodyChanged, bodyText, activeTemplate],
  )

  // The list can gain an id later; fall back to the first one the API knows.
  useEffect(() => {
    if (ids.length && !ids.includes(activeId)) setActiveId(ids[0])
  }, [ids, activeId])

  useEffect(() => {
    if (!activeTemplate) return
    setSubject(activeTemplate.subject)
    setBodyText(htmlToPlainText(activeTemplate.body_html))
  }, [activeId, activeTemplate])

  // Every detail this email can include, offered the same way. None is required: an
  // administrator may use any of them, all of them or none.
  const details = useMemo(() => {
    const own = data?.placeholders?.[activeId] ?? []
    const common = data?.common_placeholders ?? ['{{company_name}}']
    return [...own, ...common.filter((t) => !own.includes(t))]
  }, [data, activeId])

  // An empty email cannot be sent, so that is the only thing that blocks a save or a preview.
  const hasContent = subject.trim() !== '' && bodyText.trim() !== ''

  // Live preview of exactly what would be saved, from the server so it is rendered the
  // way the real email is. Not requested for an empty email, which the server refuses.
  const debouncedSubject = useDebounced(subject, 500)
  const debouncedHtml = useDebounced(bodyHtml, 500)
  const preview = useQuery<{ subject: string; body_html: string }>({
    queryKey: ['email-template-preview', activeId, debouncedSubject, debouncedHtml],
    queryFn: () =>
      api.post(`/api/settings/email-templates/${activeId}/preview`, {
        subject: debouncedSubject,
        body_html: debouncedHtml,
      }) as unknown as Promise<{ subject: string; body_html: string }>,
    enabled: !!activeTemplate && hasContent,
    retry: false,
    staleTime: 60_000,
    // Keep the last preview on screen while a new one loads as you type, so it does not
    // flicker. Never across templates: that would show one email under another's name.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === activeId ? previous : undefined,
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
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to restore template'),
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

  const insertPlaceholder = (token: string) => {
    const el = bodyRef.current
    if (!el) {
      setBodyText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    setBodyText(`${bodyText.slice(0, start)}${token}${bodyText.slice(end)}`)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  const select = (id: string) => {
    if (id === activeId) return
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
    setActiveId(id)
  }

  if (isLoading || !data) {
    return <div className="h-64 animate-pulse rounded-card border border-line bg-surface-2" />
  }

  const { label, when } = metaFor(activeId)
  const edited = (activeTemplate?.version ?? 1) > 1
  const previewFor = hasContent ? preview.data : undefined

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">Email templates</h3>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Write each email in plain language and insert candidate details with the buttons. No HTML
          needed. Company name is filled in with your organization&rsquo;s name.
        </p>
      </div>

      <TemplateTabs ids={ids} activeId={activeId} templates={data.templates} onSelect={select} />

      <div id="tpl-panel" role="tabpanel" aria-labelledby={`tpl-tab-${activeId}`} className="min-w-0 space-y-5">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h4 className="text-[15px] font-semibold text-ink">{label}</h4>
              {when && <p className="mt-0.5 text-[12px] text-ink-muted">{when}</p>}
            </div>
            {edited && <Badge tone="neutral">Edited</Badge>}
          </div>

          <div className="space-y-5 p-5">
            <div>
              <label htmlFor="template-subject" className="mb-1.5 block text-xs font-medium text-ink-muted">
                Subject line
              </label>
              <input
                id="template-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={INPUT}
              />
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="template-body" className="text-xs font-medium text-ink-muted">
                  Message
                </label>
                <span className="text-[11px] text-ink-subtle">
                  Leave a blank line between paragraphs.
                </span>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Insert into message">
                <span className="mr-1 text-[12px] font-medium text-ink-muted">Insert</span>
                {details.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => insertPlaceholder(token)}
                    title="Filled in automatically for each candidate. Click to insert."
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <Plus className="h-3 w-3 text-ink-subtle" aria-hidden />
                    {placeholderLabel(token)}
                  </button>
                ))}
              </div>

              <textarea
                id="template-body"
                ref={bodyRef}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={16}
                placeholder="Write the email message here…"
                className={TEXTAREA}
              />

              <p className="mt-2 text-[12px] leading-relaxed text-ink-subtle">
                Click a button to insert a detail. Each is filled in automatically for every
                candidate. Use as many or as few as you like.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-5 py-3">
            <button
              type="button"
              onClick={() => restoreMutation.mutate()}
              disabled={!edited || restoreMutation.isPending}
              title={edited ? undefined : 'This template has not been changed'}
              className={BTN_GHOST}
            >
              {restoreMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              Restore default
            </button>
            <span className="ml-auto text-[12px] text-ink-muted" aria-live="polite">
              {dirty ? 'Unsaved changes' : ''}
            </span>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || !hasContent || saveMutation.isPending}
              className={BTN_PRIMARY}
            >
              {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Save changes
            </button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h4 className="text-[14px] font-semibold text-ink">Candidate preview</h4>
            <span className="flex items-center gap-1.5 text-[12px] text-ink-muted" aria-live="polite">
              {preview.isFetching && hasContent ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Updating
                </>
              ) : (
                'Sample candidate details'
              )}
            </span>
          </div>

          {!hasContent ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-muted">
              Write a subject and a message to see the preview.
            </p>
          ) : preview.isError ? (
            <p className="px-5 py-10 text-center text-[13px] text-warn" role="alert">
              Preview unavailable: {preview.error instanceof Error ? preview.error.message : 'try again'}
            </p>
          ) : previewFor ? (
            <div>
              <div className="border-b border-line bg-surface-2 px-5 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  Subject
                </p>
                <p className="mt-0.5 text-[14px] font-medium text-ink">{previewFor.subject}</p>
              </div>
              <EmailFrame html={previewFor.body_html} />
            </div>
          ) : (
            <div className="m-5 h-40 animate-pulse rounded-card bg-surface-2" />
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="test-email" className="mb-1.5 block text-xs font-medium text-ink-muted">
                Send a test to yourself
              </label>
              <input
                id="test-email"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@company.com"
                className={INPUT}
              />
            </div>
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={!testEmail || !hasContent || testMutation.isPending}
              className={`${BTN_GHOST} h-11`}
            >
              {testMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Mail size={14} />
              )}
              Send test
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
