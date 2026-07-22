import { type FormEvent, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { AuditLogListResponse } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { WORKFLOW_CARD_CLASS, WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

const ENTITY_BADGE: Record<string, string> = {
  candidate: 'bg-sky-50 text-sky-700',
  job: 'bg-violet-50 text-violet-700',
  shortlist: 'bg-amber-50 text-amber-800',
  screening: 'bg-emerald-50 text-emerald-700',
  interview: 'bg-indigo-50 text-indigo-700',
  user: 'bg-rose-50 text-rose-700',
  settings: 'bg-slate-100 text-slate-700',
}

const ACTION_LABELS: Record<string, string> = {
  'job.created': 'Created job',
  'job.updated': 'Updated job',
  'job.deleted': 'Deleted job',
  'candidate.uploaded': 'Uploaded resume',
  'candidate.updated': 'Updated candidate',
  'candidate.deleted': 'Deleted candidate',
  'candidate.retry_parse': 'Retried resume parse',
  'shortlist.triggered': 'Started shortlisting',
  'shortlist.decision_set': 'Set shortlist decision',
  'shortlist.feedback_set': 'Added shortlist feedback',
  'screening.triggered': 'Triggered screening',
  'screening.result_set': 'Set screening result',
  'interview.queued': 'Queued interview',
  'interview.scheduled': 'Scheduled interview',
  'interview.link_sent': 'Sent interview link',
  'interview.decision_set': 'Set interview decision',
  'interview.rescheduled': 'Rescheduled interview',
  'interview.retry_assessment': 'Retried assessment',
  'user.created': 'Created user',
  'user.updated': 'Updated user',
  'user.deleted': 'Deleted user',
  'settings.updated': 'Updated settings',
  'settings.email_template_updated': 'Updated email template',
  'settings.email_template_restored': 'Restored email template',
}

const FEATURE_LABELS: Record<string, string> = {
  hr_decision: 'Decision',
  shortlist: 'Shortlist',
  resume: 'Resume',
  job: 'Job',
  status: 'Status',
  title: 'Title',
  phone: 'Phone',
  name: 'Name',
  email: 'Email',
  pipeline_status: 'Pipeline status',
  result: 'Result',
  screening: 'Screening',
  interview_queue: 'Interview queue',
  interview_link: 'Interview link',
  interview_session: 'Interview session',
  scheduled_interview_at: 'Scheduled time',
  user: 'User',
  password: 'Password',
  role: 'Role',
  is_active: 'Active status',
  full_name: 'Full name',
  email_templates: 'Email template',
  screening_enabled: 'Screening enabled',
  voice_screening_enabled: 'Voice screening (job)',
  allowed_phone_regions: 'Phone regions',
  enforce_phone_geography: 'Phone geography',
  screening_max_retries: 'Max retries',
  screening_retry_delay_seconds: 'Retry delay',
  hr_feedback_type: 'Feedback type',
  hr_comments: 'Comments',
  description: 'Description',
  required_skills: 'Skills',
  experience_min: 'Min experience',
  experience_max: 'Max experience',
  screening_questions: 'Screening questions',
  interview_questions: 'Interview questions',
  screening_call_from: 'Call window start',
  screening_call_to: 'Call window end',
  screening_timezone: 'Timezone',
  candidate: 'Candidate',
}

function humanAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/\./g, ' · ').replace(/_/g, ' ')
}

function humanFeature(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.replace(/_/g, ' ')
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (value.every((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))) {
      return `${value.length} item${value.length === 1 ? '' : 's'}`
    }
    return value.map((item) => formatValue(item)).join(', ')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanFeature(k)}: ${formatValue(v)}`)
      .join(' · ')
  }
  return String(value)
}

function formatState(state: Record<string, unknown> | null | undefined): string {
  if (!state || Object.keys(state).length === 0) return '—'
  const entries = Object.entries(state)
  if (entries.length === 1) {
    const [key, value] = entries[0]
    if (key === 'candidate_count' && typeof value === 'number') {
      return `${value} candidate${value === 1 ? '' : 's'}`
    }
    if (key === 'candidate_ids' && Array.isArray(value)) {
      return `${value.length} candidate${value.length === 1 ? '' : 's'}`
    }
    if (key === 'original_filename' && typeof value === 'string') return value
    return formatValue(value)
  }
  if ('candidate_count' in state && typeof state.candidate_count === 'number') {
    return `${state.candidate_count} candidate${state.candidate_count === 1 ? '' : 's'}`
  }
  if ('title' in state && 'status' in state) {
    return `${formatValue(state.title)} (${formatValue(state.status)})`
  }
  return entries
    .filter(([k]) => k !== 'candidate_ids')
    .map(([key, value]) => `${humanFeature(key)}: ${formatValue(value)}`)
    .join(' · ')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function StateCell({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'line-clamp-2 max-w-[11rem] break-words text-xs',
        muted ? 'text-slate-500' : 'font-medium text-slate-800',
      )}
      title={value}
    >
      {value}
    </span>
  )
}

export default function ActivityPage() {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const params = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set('limit', String(PAGE_SIZE))
    sp.set('offset', String(offset))
    if (search.trim()) sp.set('q', search.trim())
    return sp.toString()
  }, [offset, search])

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditLogListResponse>({
    queryKey: ['audit-logs', params],
    queryFn: () =>
      api.get(`/api/audit-logs?${params}`) as unknown as Promise<AuditLogListResponse>,
  })

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasSearch = Boolean(search.trim())

  function applySearch(e: FormEvent) {
    e.preventDefault()
    setOffset(0)
    setSearch(q)
  }

  function clearSearch() {
    setQ('')
    setSearch('')
    setOffset(0)
  }

  if (isError) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <Activity className="h-5 w-5 text-slate-500" />
            Activity
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Audit trail of changes across the recruitment pipeline.
          </p>
        </div>
        {hasSearch && (
          <button
            type="button"
            onClick={clearSearch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <X className="h-4 w-4" />
            Clear search
          </button>
        )}
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-4`}>
        <form onSubmit={applySearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={cn(WORKFLOW_INPUT_CLASS, 'pl-9')}
              placeholder="Search subject, actor, or action…"
            />
          </div>
          <button
            type="submit"
            className="h-11 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Search
          </button>
        </form>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">Actor</th>
                <th className="px-3 py-3 font-medium">Subject</th>
                <th className="px-3 py-3 font-medium">Feature</th>
                <th className="px-3 py-3 font-medium">Before</th>
                <th className="px-3 py-3 font-medium">After</th>
                <th className="px-3 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Activity className="mx-auto mb-2 h-8 w-8 text-zinc-300" />
                    <p className="text-sm font-medium text-slate-700">No matching activity</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {hasSearch
                        ? 'Try a different search term.'
                        : 'Changes will appear here as people use the app.'}
                    </p>
                  </td>
                </tr>
              )}
              {!isLoading &&
                items.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">
                      {formatTime(row.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">{row.actor_name}</div>
                      <span
                        className={cn(
                          'mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          row.actor_role === 'admin'
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-zinc-100 text-zinc-600',
                        )}
                      >
                        {row.actor_role}
                      </span>
                    </td>
                    <td className="max-w-[10rem] px-3 py-3">
                      <div className="truncate font-medium text-slate-800" title={row.subject_label}>
                        {row.subject_label}
                      </div>
                      <span
                        className={cn(
                          'mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
                          ENTITY_BADGE[row.entity_type] ?? 'bg-zinc-100 text-zinc-600',
                        )}
                      >
                        {row.entity_type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-700">{humanFeature(row.feature)}</td>
                    <td className="px-3 py-3">
                      <StateCell value={formatState(row.before_state)} muted />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-1.5">
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-300" />
                        <StateCell value={formatState(row.after_state)} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-700">{humanAction(row.action)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm text-slate-600">
          <span>
            {total.toLocaleString()} event{total === 1 ? '' : 's'}
            {isFetching ? ' · updating…' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 hover:bg-zinc-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <span className="text-xs text-slate-500">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 hover:bg-zinc-50 disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
