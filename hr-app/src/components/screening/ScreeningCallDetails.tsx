import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Briefcase,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  FileText,
  Loader2,
  Mic,
  Phone,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ScreeningCall, ScreeningResult } from '@/types/api'

function formatCallDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function humanizeEndedReason(reason: string): string {
  return reason.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function truncateText(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

const RESULT_CONFIG: Record<
  ScreeningResult,
  {
    label: string
    icon: typeof CheckCircle2
    badge: string
    dot: string
    avatarBg: string
    avatarText: string
    headerBg: string
    accentBorder: string
  }
> = {
  pass: {
    label: 'Passed',
    icon: CheckCircle2,
    badge: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-500',
    avatarBg: 'bg-emerald-100',
    avatarText: 'text-emerald-700',
    headerBg: 'bg-gradient-to-r from-emerald-50/90 to-white',
    accentBorder: 'border-emerald-100',
  },
  fail: {
    label: 'Failed',
    icon: XCircle,
    badge: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
    avatarBg: 'bg-rose-100',
    avatarText: 'text-rose-700',
    headerBg: 'bg-gradient-to-r from-rose-50/90 to-white',
    accentBorder: 'border-rose-100',
  },
  needs_review: {
    label: 'Review',
    icon: Sparkles,
    badge: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
    avatarBg: 'bg-amber-100',
    avatarText: 'text-amber-800',
    headerBg: 'bg-gradient-to-r from-amber-50/90 to-white',
    accentBorder: 'border-amber-100',
  },
}

const QUALITY_WIDTH: Record<string, string> = {
  excellent: 'w-full',
  good: 'w-3/4',
  fair: 'w-1/2',
  poor: 'w-1/4',
}

const QUALITY_COLOR: Record<string, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-blue-500',
  fair: 'bg-amber-500',
  poor: 'bg-rose-500',
}

type TranscriptTurn = { speaker: 'ai' | 'candidate' | 'unknown'; text: string }

function parseTranscript(transcript: string): TranscriptTurn[] {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const turns: TranscriptTurn[] = []

  for (const line of lines) {
    const aiMatch = line.match(/^(?:AI|Assistant|Agent|Bot)\s*[:|-]\s*(.+)$/i)
    const userMatch = line.match(/^(?:User|Customer|Candidate|Human)\s*[:|-]\s*(.+)$/i)
    if (aiMatch) {
      turns.push({ speaker: 'ai', text: aiMatch[1].trim() })
      continue
    }
    if (userMatch) {
      turns.push({ speaker: 'candidate', text: userMatch[1].trim() })
      continue
    }
    if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`
    } else {
      turns.push({ speaker: 'unknown', text: line })
    }
  }

  if (turns.length === 0 && transcript.trim()) {
    return [{ speaker: 'unknown', text: transcript.trim() }]
  }
  return turns
}

function DetailCard({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-xs leading-snug text-slate-800">{value}</p>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </span>
  )
}

function ScreeningActionBar({ call, jobId }: { call: ScreeningCall; jobId: string }) {
  const queryClient = useQueryClient()
  const isApproved = call.result === 'pass'
  const isQueued = Boolean(call.interview_queued_at)
  const hasSession = Boolean(call.has_interview_session)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
    queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
  }

  const decisionMutation = useMutation({
    mutationFn: (result: ScreeningResult) =>
      api.patch(`/api/screening/${call.id}/result`, { result }),
    onSuccess: () => {
      invalidate()
      toast.success('Decision saved')
    },
    onError: () => toast.error('Failed to update decision'),
  })

  const queueMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/candidates/${call.candidate_id}/interview/queue`),
    onSuccess: () => {
      invalidate()
      toast.success('Candidate queued for interview')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to queue for interview'),
  })

  const scheduleMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/candidates/${call.candidate_id}/interview/send`),
    onSuccess: () => {
      invalidate()
      toast.success('Interview link sent')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to schedule interview'),
  })

  const busy =
    decisionMutation.isPending || queueMutation.isPending || scheduleMutation.isPending

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[11px] font-medium text-slate-600">HR actions</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decisionMutation.mutate('pass')}
          disabled={busy}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            call.result === 'pass'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
          }`}
        >
          {decisionMutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ThumbsUp size={13} />
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={() => decisionMutation.mutate('fail')}
          disabled={busy}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            call.result === 'fail'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50'
          }`}
        >
          {decisionMutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ThumbsDown size={13} />
          )}
          Reject
        </button>
        <button
          type="button"
          onClick={() => queueMutation.mutate()}
          disabled={busy || !isApproved || isQueued || hasSession}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            isQueued
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50'
          }`}
        >
          {queueMutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CalendarClock size={13} />
          )}
          {isQueued ? 'Queued' : 'Queue interview'}
        </button>
        <button
          type="button"
          onClick={() => scheduleMutation.mutate()}
          disabled={busy || !isApproved || hasSession}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            hasSession
              ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
              : 'border border-indigo-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
          }`}
        >
          {scheduleMutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
          {hasSession ? 'Scheduled' : 'Schedule'}
        </button>
      </div>
      {!isApproved && (
        <p className="text-[10px] text-slate-500">Approve to enable interview actions.</p>
      )}
    </div>
  )
}

export function ScreeningCallDetails({
  call,
  jobId,
  attemptNumber,
  candidateName,
  phone,
  variant = 'embedded',
  collapsible,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
}: {
  call: ScreeningCall
  jobId: string
  attemptNumber?: number
  candidateName?: string
  phone?: string | null
  variant?: 'embedded' | 'card'
  collapsible?: boolean
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded)

  const isCollapsible = collapsible ?? variant === 'card'
  const expanded = expandedProp ?? expandedInternal
  const isCompactCard = variant === 'card' && isCollapsible

  const setExpanded = (value: boolean) => {
    if (expandedProp === undefined) setExpandedInternal(value)
    onExpandedChange?.(value)
  }

  const toggleExpanded = () => {
    if (!isCollapsible) return
    setExpanded(!expanded)
  }

  if (call.call_status !== 'completed') return null

  const resultKey = call.result ?? 'needs_review'
  const result = RESULT_CONFIG[resultKey]
  const ResultIcon = result.icon

  const willingness =
    call.willingness_to_proceed === true
      ? { label: 'Interested', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' }
      : call.willingness_to_proceed === false
        ? { label: 'Not interested', tone: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100' }
        : null

  const transcriptTurns = useMemo(
    () => (call.transcript ? parseTranscript(call.transcript) : []),
    [call.transcript],
  )

  const collapsedHighlights = useMemo(() => {
    const items: string[] = []
    if (call.availability?.trim()) items.push(`Avail: ${truncateText(call.availability, 28)}`)
    if (call.expected_ctc?.trim()) items.push(`CTC: ${call.expected_ctc}`)
    else if (call.current_ctc?.trim()) items.push(`CTC: ${call.current_ctc}`)
    if (call.notice_period?.trim()) items.push(`Notice: ${call.notice_period}`)
    if (call.communication_quality) {
      items.push(`Comm: ${call.communication_quality}`)
    }
    if (call.employment_status?.trim()) {
      items.push(truncateText(call.employment_status, 24))
    }
    return items
  }, [call])

  const collapsedMeta = [
    phone,
    formatCallDate(call.created_at),
    attemptNumber != null ? `Attempt ${attemptNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const toggleProps = {
    onClick: isCollapsible ? toggleExpanded : undefined,
    onKeyDown: isCollapsible
      ? (e: { key: string; preventDefault: () => void }) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleExpanded()
          }
        }
      : undefined,
    role: isCollapsible ? ('button' as const) : undefined,
    tabIndex: isCollapsible ? 0 : undefined,
  }

  const collapsedCard = (
    <div>
      <div
        {...toggleProps}
        className={`flex gap-3 px-3.5 py-2.5 ${
          isCollapsible ? 'cursor-pointer select-none hover:bg-slate-50/80' : ''
        }`}
        aria-expanded={false}
      >
        {candidateName && (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${result.avatarBg} ${result.avatarText}`}
          >
            {initials(candidateName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {candidateName && (
                  <span className="truncate text-sm font-semibold text-slate-900">{candidateName}</span>
                )}
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${result.badge}`}
                >
                  <ResultIcon size={10} />
                  {result.label}
                </span>
                {willingness && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${willingness.tone}`}>
                    {willingness.label}
                  </span>
                )}
              </div>
              {(call.summary || call.relevant_experience) && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-600">
                  {call.summary?.trim() || call.relevant_experience?.trim()}
                </p>
              )}
              {collapsedHighlights.length > 0 && (
                <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                  {collapsedHighlights.join(' · ')}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-slate-400">{collapsedMeta}</p>
            </div>
            {isCollapsible && (
              <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-400" />
            )}
          </div>
        </div>
      </div>
      <div className="px-3.5 pb-2.5">
        <ScreeningActionBar call={call} jobId={jobId} />
      </div>
    </div>
  )

  const expandedHeader = (
    <div
      {...toggleProps}
      className={`border-b ${result.accentBorder} ${result.headerBg} px-3.5 py-3 ${
        isCollapsible ? 'cursor-pointer select-none hover:opacity-95' : ''
      }`}
      aria-expanded={true}
    >
      <div className="flex items-start gap-3">
        {candidateName && (
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${result.avatarBg} ${result.avatarText}`}
          >
            {initials(candidateName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {candidateName && (
                <h3 className="truncate text-sm font-bold text-slate-900">{candidateName}</h3>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${result.badge}`}
                >
                  <ResultIcon size={10} />
                  {result.label}
                </span>
                {willingness && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${willingness.tone}`}>
                    {willingness.label}
                  </span>
                )}
                {attemptNumber != null && (
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                    Attempt {attemptNumber}
                  </span>
                )}
              </div>
            </div>
            {isCollapsible && (
              <ChevronDown size={18} className="shrink-0 rotate-180 text-slate-500" />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} className="text-slate-400" />
                {phone}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} className="text-slate-400" />
              {formatCallDate(call.created_at)}
            </span>
            {call.ended_reason && (
              <span className="text-slate-400">{humanizeEndedReason(call.ended_reason)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const quickStats = [
    { label: 'Availability', value: call.availability },
    { label: 'Notice', value: call.notice_period },
    { label: 'Employment', value: call.employment_status },
    { label: 'Location', value: call.location_preference },
  ]

  const hasDetailContent =
    call.summary ||
    call.relevant_experience ||
    call.current_ctc ||
    call.expected_ctc ||
    quickStats.some((s) => s.value?.trim())

  const outerClass = isCompactCard
    ? expanded
      ? 'mx-1 my-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm'
      : ''
    : 'overflow-hidden rounded-lg border border-slate-200 bg-white'

  if (isCollapsible && !expanded) {
    return <div className={outerClass}>{collapsedCard}</div>
  }

  return (
    <div className={outerClass}>
      {expandedHeader}

      {(!isCollapsible || expanded) && (
        <div className="space-y-3 px-3.5 py-3">
          {call.summary && (
            <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Sparkles size={12} className="text-indigo-500" />
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                  AI summary
                </h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-700">{call.summary}</p>
            </section>
          )}

          {quickStats.some((s) => s.value?.trim()) && (
            <section className="flex flex-wrap gap-1.5">
              {quickStats.map((s) => (
                <StatChip key={s.label} label={s.label} value={s.value} />
              ))}
              {call.communication_quality && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]">
                  <Mic size={11} className="text-slate-400" />
                  <span className="text-slate-400">Comm.</span>
                  <span className="font-medium capitalize text-slate-700">{call.communication_quality}</span>
                </span>
              )}
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <Briefcase size={11} />
                Background
              </h4>
              <DetailCard label="Relevant experience" value={call.relevant_experience} />
              <DetailCard label="Employment status" value={call.employment_status} />
              <DetailCard label="Location preference" value={call.location_preference} />
              {call.communication_quality && (
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Communication
                    </p>
                    <span className="text-[11px] font-semibold capitalize text-slate-700">
                      {call.communication_quality}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${QUALITY_COLOR[call.communication_quality] ?? 'bg-slate-400'} ${QUALITY_WIDTH[call.communication_quality] ?? 'w-1/2'}`}
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <DollarSign size={11} />
                Compensation & timing
              </h4>
              {(call.current_ctc || call.expected_ctc) && (
                <div className="grid grid-cols-2 gap-2">
                  {call.current_ctc && (
                    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Current
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">{call.current_ctc}</p>
                    </div>
                  )}
                  {call.expected_ctc && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
                        Expected
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-indigo-900">{call.expected_ctc}</p>
                    </div>
                  )}
                </div>
              )}
              <DetailCard label="Availability to join" value={call.availability} />
              <DetailCard label="Notice period" value={call.notice_period} />
            </section>
          </div>

          {!hasDetailContent && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center">
              <Mic className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
              <p className="text-xs font-medium text-slate-600">Limited structured data</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Review the transcript below and set an HR decision.
              </p>
            </div>
          )}

          <ScreeningActionBar call={call} jobId={jobId} />

          {call.transcript && (
            <section onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:bg-slate-100"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <FileText size={14} className="text-indigo-500" />
                  Call transcript
                  <span className="font-normal text-slate-400">
                    ({transcriptTurns.length} segments)
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 transition-transform ${showTranscript ? 'rotate-180' : ''}`}
                />
              </button>
              {showTranscript && (
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5">
                  {transcriptTurns.map((turn, i) => (
                    <div
                      key={i}
                      className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                          turn.speaker === 'ai'
                            ? 'rounded-bl-sm bg-indigo-50 text-indigo-950'
                            : turn.speaker === 'candidate'
                              ? 'rounded-br-sm bg-slate-100 text-slate-800'
                              : 'bg-slate-50 text-slate-700 ring-1 ring-slate-100'
                        }`}
                      >
                        {turn.speaker !== 'unknown' && (
                          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide opacity-60">
                            {turn.speaker === 'ai' ? 'AI screener' : 'Candidate'}
                          </p>
                        )}
                        {turn.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
