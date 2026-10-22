import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Search, Shield } from 'lucide-react'
import { api } from '@/lib/api'
import type { AuditLogListResponse, Job } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { BTN_GHOST, Card, EmptyState } from '@/components/ui/Surface'
import { useAuth } from '@/context/AuthContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { fetchJobCandidates, fetchUsers, resumeDisplayName } from '@/lib/workflow'
import {
  ACTIVITY_CATEGORIES,
  dayKey,
  dayLabel,
  describeActivity,
  formatClock,
  isPlatformActor,
  type ActivityChange,
  type Chip,
  type ChipTone,
} from '@/lib/activityFormat'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

type Range = 'all' | '7' | '30' | 'custom'

const RANGES: Array<{ value: Range; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Custom…' },
]

/*
 * `bg-surface-2` and `bg-surface-3` do not resolve in this app: tailwind.config.ts defines
 * `surface` twice, and the second (a legacy '#ffffff') replaces the object that holds them, so
 * those classes generate no CSS anywhere. The tokens themselves are fine, so this page
 * addresses them directly. Switch these back when the config is fixed.
 */
const BG_SURFACE_2 = 'bg-[rgb(var(--surface-2))]'
const BG_SURFACE_3 = 'bg-[rgb(var(--surface-3))]'
const HOVER_SURFACE_2 = 'hover:bg-[rgb(var(--surface-2))]'

const SELECT =
  'h-10 min-w-0 max-w-full rounded-md border border-line bg-surface px-3 text-[13px] text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60'

const CHIP_TONES: Record<ChipTone, string> = {
  muted: `${BG_SURFACE_3} text-ink-muted`,
  plain: `${BG_SURFACE_3} font-medium text-ink`,
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  neg: 'bg-neg-soft text-neg',
}

function ChipView({ chip }: { chip: Chip }) {
  return (
    <span
      title={chip.title}
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
        CHIP_TONES[chip.tone],
      )}
    >
      {chip.text}
    </span>
  )
}

function ChangeCell({ change }: { change: ActivityChange }) {
  if (!change) return <span className="text-[12.5px] text-ink-muted">—</span>
  if (change.kind === 'text') return <span className="text-[12.5px] text-ink-muted">{change.text}</span>
  if (change.kind === 'chip') return <ChipView chip={change.chip} />
  return (
    <div className="flex items-center gap-1.5 overflow-hidden">
      <ChipView chip={change.from} />
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
      <ChipView chip={change.to} />
    </div>
  )
}

/** Local midnight `days` ago, so the value is stable all day and does not refetch on every render. */
function daysAgoISO(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

const PlatformMark = () => (
  <span title="Done by a platform administrator, not by someone in your organization">
    <Shield className="h-3.5 w-3.5 text-warn" aria-label="Done by platform support" />
  </span>
)

export default function ActivityPage() {
  const { user: currentUser } = useAuth()
  const [q, setQ] = useState('')
  const [range, setRange] = useState<Range>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [category, setCategory] = useState('')
  const [actorId, setActorId] = useState('')
  const [jobId, setJobId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const search = useDebouncedValue(q.trim(), 350)

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })
  const { data: users } = useQuery({
    queryKey: ['users', currentUser?.tenant_id],
    queryFn: () => fetchUsers(),
  })
  const { data: candidates = [], isLoading: candidatesLoading } = useQuery({
    queryKey: ['activity-candidates', jobId],
    queryFn: () => fetchJobCandidates(jobId),
    enabled: Boolean(jobId),
  })

  const sortedJobs = useMemo(
    () => [...(jobs ?? [])].sort((a, b) => a.title.localeCompare(b.title)),
    [jobs],
  )

  const params = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set('limit', String(PAGE_SIZE))
    sp.set('offset', String(offset))
    if (search) sp.set('q', search)
    if (category) sp.set('category', category)
    if (actorId) sp.set('actor_user_id', actorId)
    if (jobId) sp.set('job_id', jobId)
    if (candidateId) sp.set('candidate_id', candidateId)
    if (range === '7' || range === '30') sp.set('from', daysAgoISO(Number(range)))
    if (range === 'custom') {
      if (fromDate) sp.set('from', new Date(`${fromDate}T00:00:00`).toISOString())
      if (toDate) sp.set('to', new Date(`${toDate}T23:59:59.999`).toISOString())
    }
    return sp.toString()
  }, [offset, search, category, actorId, jobId, candidateId, range, fromDate, toDate])

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditLogListResponse>({
    queryKey: ['audit-logs', params],
    queryFn: () => api.get(`/api/audit-logs?${params}`) as unknown as Promise<AuditLogListResponse>,
    // Keep the last page on screen while the next loads, so typing or paging does not flash.
    placeholderData: (previous) => previous,
  })

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(q.trim() || range !== 'all' || category || actorId || jobId || candidateId)

  /** Any filter change goes back to the first page. */
  const change = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setOffset(0)
  }

  function clearFilters() {
    setQ('')
    setRange('all')
    setFromDate('')
    setToDate('')
    setCategory('')
    setActorId('')
    setJobId('')
    setCandidateId('')
    setOffset(0)
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (isError) return <BackendError onRetry={refetch} />

  const rows = items.map((row) => ({ row, view: describeActivity(row), at: new Date(row.created_at) }))

  return (
    <div className="mx-auto max-w-6xl">
      <Card className="mb-0 grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-0 flex-[1_1_220px]">
            <span className="sr-only">Search activity</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              value={q}
              onChange={(e) => change(setQ)(e.target.value)}
              placeholder="Search by person, candidate, job or event…"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-[13.5px] text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
          </label>
          <div role="group" aria-label="Date range" className={cn('inline-flex max-w-full overflow-x-auto rounded-md border border-line p-0.5', BG_SURFACE_2)}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => change(setRange)(r.value)}
                className={cn(
                  'whitespace-nowrap rounded px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  range === r.value ? 'bg-surface text-ink shadow-e1' : 'text-ink-muted hover:text-ink',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink-muted">
            <label className="flex items-center gap-2">
              From
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => change(setFromDate)(e.target.value)} className={SELECT} />
            </label>
            <label className="flex items-center gap-2">
              To
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => change(setToDate)(e.target.value)} className={SELECT} />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <select aria-label="Who" value={actorId} onChange={(e) => change(setActorId)(e.target.value)} className={SELECT}>
            <option value="">Everyone</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </select>
          <select aria-label="Kind of activity" value={category} onChange={(e) => change(setCategory)(e.target.value)} className={SELECT}>
            <option value="">All activity</option>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Job"
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value)
              setCandidateId('')
              setOffset(0)
            }}
            className={cn(SELECT, 'max-w-[250px]')}
          >
            <option value="">All jobs</option>
            {sortedJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Candidate"
            value={candidateId}
            onChange={(e) => change(setCandidateId)(e.target.value)}
            disabled={!jobId}
            className={SELECT}
          >
            <option value="">{jobId ? (candidatesLoading ? 'Loading candidates…' : 'All candidates') : 'All candidates'}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {resumeDisplayName(c)}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="px-2 py-2 text-[12.5px] font-semibold text-ink-muted hover:text-ink">
              Clear filters
            </button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pb-2 pt-3.5 text-[12.5px] text-ink-muted">
        <span aria-live="polite">
          <b className="font-semibold text-ink">{total.toLocaleString()}</b> event{total === 1 ? '' : 's'}
          {hasFilters ? ' match your filters' : ''}
          {isFetching && !isLoading ? ' · updating…' : ''}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-warn" aria-hidden /> Done by platform support
        </span>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn('h-9 animate-pulse rounded-md', BG_SURFACE_2)} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matching activity"
            body={hasFilters ? 'Try a wider date range or clear the filters.' : 'Changes will appear here as people use the app.'}
          />
        ) : (
          <div className="relative overflow-x-auto">
            {/* `relative` makes this the containing block for the absolutely positioned sr-only
                label in the last header cell; without it that label escapes the scroll area and
                the whole page scrolls sideways on a phone. */}
            <table className="w-full border-separate border-spacing-0 text-left text-[13.5px]">
              <thead>
                <tr className={cn(BG_SURFACE_2, 'text-[11.5px] uppercase tracking-wide text-ink-muted')}>
                  {['Time', 'Who', 'Event', 'Applies to', 'Change'].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap border-b border-line-strong px-3.5 py-3 font-bold">
                      {h}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-line-strong px-3.5 py-3">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, view, at }, i) => {
                  const day = dayKey(at)
                  const newDay = i === 0 || dayKey(rows[i - 1].at) !== day
                  const isOpen = open.has(row.id)
                  return (
                    <Fragment key={row.id}>
                      {newDay && (
                        <tr>
                          <td colSpan={6} className={cn(BG_SURFACE_3, 'border-b border-line px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-wider text-ink-muted')}>
                            {dayLabel(at)}
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => toggle(row.id)}
                        className={cn('cursor-pointer transition-colors', HOVER_SURFACE_2)}
                      >
                        <td className="w-[92px] whitespace-nowrap border-b border-line px-3.5 py-3 tabular-nums text-ink-muted">
                          {formatClock(at)}
                        </td>
                        <td className="w-[190px] whitespace-nowrap border-b border-line px-3.5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            {row.actor_name}
                            {isPlatformActor(row.actor_role) && <PlatformMark />}
                          </span>
                        </td>
                        <td className="w-[210px] whitespace-nowrap border-b border-line px-3.5 py-3 font-semibold text-ink">
                          {view.event}
                        </td>
                        <td className="max-w-[300px] whitespace-nowrap border-b border-line px-3.5 py-3">
                          {view.link ? (
                            <Link
                              to={view.link}
                              onClick={(e) => e.stopPropagation()}
                              title={view.subject}
                              className="block max-w-[280px] truncate font-semibold text-accent hover:underline"
                            >
                              {view.subject}
                            </Link>
                          ) : (
                            <span title={view.subject} className="block max-w-[280px] truncate font-semibold text-ink">
                              {view.subject}
                            </span>
                          )}
                          <small className="block text-[11.5px] text-ink-muted">{view.kind}</small>
                        </td>
                        <td className="max-w-[300px] whitespace-nowrap border-b border-line px-3.5 py-3">
                          <ChangeCell change={view.change} />
                        </td>
                        <td className="w-[34px] border-b border-line px-3.5 py-3 text-right text-ink-subtle">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={isOpen ? 'Hide details' : 'Show details'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggle(row.id)
                            }}
                            className="rounded p-0.5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          >
                            <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className={cn(BG_SURFACE_2, 'border-b border-line px-5 pb-4 pt-3.5 sm:pl-[106px]')}>
                            <dl className="grid max-w-[620px] grid-cols-[120px_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
                              {view.details.map(([label, value], k) => (
                                <Fragment key={`${label}-${k}`}>
                                  <dt className="text-ink-muted">{label}</dt>
                                  <dd className="m-0 break-words text-ink">{value}</dd>
                                </Fragment>
                              ))}
                            </dl>
                            {view.note && <p className="mt-2.5 text-[12.5px] text-ink-muted">{view.note}</p>}
                            <p className="mt-2.5 break-all border-t border-dashed border-line-strong pt-2.5 font-mono text-[11.5px] text-ink-subtle">
                              {view.tech}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12.5px] text-ink-muted">
          <span>
            {total === 0 ? '0 events' : (
              <>
                {offset + 1}–{Math.min(total, offset + PAGE_SIZE)} of <b className="font-semibold text-ink">{total.toLocaleString()}</b> events
              </>
            )}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className={BTN_GHOST}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <span className="tabular-nums">
              {page} / {pageCount}
            </span>
            <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className={BTN_GHOST}>
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </Card>
    </div>
  )
}
