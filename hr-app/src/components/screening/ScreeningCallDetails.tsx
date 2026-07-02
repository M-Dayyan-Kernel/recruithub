import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
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
  }
> = {
  pass: {
    label: 'Passed',
    icon: CheckCircle2,
    badge: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-500',
    avatarBg: 'bg-emerald-100',
    avatarText: 'text-emerald-700',
  },
  fail: {
    label: 'Failed',
    icon: XCircle,
    badge: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
    avatarBg: 'bg-rose-100',
    avatarText: 'text-rose-700',
  },
  needs_review: {
    label: 'Review',
    icon: Sparkles,
    badge: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
    avatarBg: 'bg-amber-100',
    avatarText: 'text-amber-800',
  },
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

function DenseField({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="min-w-0 text-slate-800">{value}</dd>
    </>
  )
}

function HrDecisionButtons({ call, jobId }: { call: ScreeningCall; jobId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (result: ScreeningResult) =>
      api.patch(`/api/screening/${call.id}/result`, { result }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      toast.success('Decision saved')
    },
    onError: () => toast.error('Failed to update decision'),
  })

  return (
    <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => mutation.mutate('pass')}
        disabled={mutation.isPending}
        title="Approve"
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
          call.result === 'pass'
            ? 'bg-emerald-600 text-white'
            : 'border border-slate-200 text-slate-600 hover:bg-emerald-50'
        }`}
      >
        {mutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
        Pass
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate('fail')}
        disabled={mutation.isPending}
        title="Reject"
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
          call.result === 'fail'
            ? 'bg-rose-600 text-white'
            : 'border border-slate-200 text-slate-600 hover:bg-rose-50'
        }`}
      >
        {mutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
        Fail
      </button>
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
  listItem = false,
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
  listItem?: boolean
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

  const collapsedCard = (
    <div
      className={`flex gap-3 px-3.5 py-2.5 ${
        isCollapsible ? 'cursor-pointer select-none hover:bg-slate-50/80' : ''
      }`}
      onClick={isCollapsible ? toggleExpanded : undefined}
      onKeyDown={
        isCollapsible
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleExpanded()
              }
            }
          : undefined
      }
      role={isCollapsible ? 'button' : undefined}
      tabIndex={isCollapsible ? 0 : undefined}
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
  )

  const headerRow = (
    <div
      className={`flex items-center gap-2 px-3 py-2 ${
        isCollapsible ? 'cursor-pointer select-none hover:bg-slate-50' : ''
      }`}
      onClick={isCollapsible ? toggleExpanded : undefined}
      onKeyDown={
        isCollapsible
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleExpanded()
              }
            }
          : undefined
      }
      role={isCollapsible ? 'button' : undefined}
      tabIndex={isCollapsible ? 0 : undefined}
      aria-expanded={isCollapsible ? expanded : undefined}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${result.dot}`} />
      {candidateName && (
        <span className="min-w-0 shrink truncate text-xs font-medium text-slate-900">
          {candidateName}
        </span>
      )}
      <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${result.badge}`}>
        {result.label}
      </span>
      {willingness && expanded && (
        <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 sm:inline ${willingness.tone}`}>
          {willingness.label}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-right text-[10px] text-slate-400">
        {collapsedMeta}
      </span>
      {isCollapsible && (
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      )}
    </div>
  )

  const outerClass = isCompactCard ? '' : 'overflow-hidden rounded-lg border border-slate-200 bg-white'

  if (isCollapsible && !expanded) {
    return <div className={outerClass}>{collapsedCard}</div>
  }

  return (
    <div className={outerClass}>
      {headerRow}

      {(!isCollapsible || expanded) && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2 text-[11px]">
          {call.summary && (
            <p className="leading-snug text-slate-600">{call.summary}</p>
          )}

          <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-0.5">
            <DenseField label="Experience" value={call.relevant_experience} />
            <DenseField label="Employment" value={call.employment_status} />
            <DenseField label="Location" value={call.location_preference} />
            <DenseField label="Availability" value={call.availability} />
            <DenseField label="Notice" value={call.notice_period} />
            <DenseField label="Current CTC" value={call.current_ctc} />
            <DenseField label="Expected CTC" value={call.expected_ctc} />
            {call.communication_quality && (
              <>
                <dt className="text-slate-400">Comm. quality</dt>
                <dd className="capitalize text-slate-800">{call.communication_quality}</dd>
              </>
            )}
            {call.ended_reason && (
              <>
                <dt className="text-slate-400">End reason</dt>
                <dd className="text-slate-600">{humanizeEndedReason(call.ended_reason)}</dd>
              </>
            )}
          </dl>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
            {call.transcript ? (
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
              >
                <FileText size={11} />
                Transcript ({transcriptTurns.length})
                <ChevronDown
                  size={11}
                  className={`transition-transform ${showTranscript ? 'rotate-180' : ''}`}
                />
              </button>
            ) : (
              <span />
            )}
            <HrDecisionButtons call={call} jobId={jobId} />
          </div>

          {showTranscript && call.transcript && (
            <div
              className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2"
              onClick={(e) => e.stopPropagation()}
            >
              {transcriptTurns.map((turn, i) => (
                <p key={i} className="leading-snug text-[10px] text-slate-700">
                  {turn.speaker !== 'unknown' && (
                    <span className="mr-1 font-semibold text-slate-400">
                      {turn.speaker === 'ai' ? 'AI:' : 'Cand:'}
                    </span>
                  )}
                  {turn.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
