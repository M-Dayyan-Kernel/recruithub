import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, LINK_ACTION, PageHeader, SectionCard } from '@/components/ui/Surface'
import { useQuery, useQueries } from '@tanstack/react-query'
import {
  Briefcase,
  Users,
  Phone,
  Video,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { fetchJobCandidates } from '@/lib/workflow'
import type { Job, Candidate, ScreeningCall } from '@/types/api'

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

/** Per-tile accent. Only the chip is saturated; the card stays paper. */
const TILE_TONES = {
  indigo: 'from-indigo-500 to-violet-600 shadow-indigo-500/30',
  violet: 'from-violet-500 to-fuchsia-600 shadow-violet-500/30',
  emerald: 'from-emerald-500 to-teal-600 shadow-emerald-500/30',
  amber: 'from-amber-400 to-orange-500 shadow-amber-500/30',
} as const

interface SummaryCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  tone: keyof typeof TILE_TONES
  subtitle?: string
  to: string
}

function SummaryCard({ title, value, icon, tone, subtitle, to }: SummaryCardProps) {
  return (
    <Link
      to={to}
      className="group relative block overflow-hidden rounded-card border border-line bg-surface p-5 shadow-e2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-e3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <div className="mb-3.5 flex items-start justify-between gap-2">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-lg ${TILE_TONES[tone]}`}
        >
          {icon}
        </span>
        <ArrowUpRight
          size={16}
          className="mt-1 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
      {/* A figure: tabular so it does not jitter between loads. */}
      <p className="font-mono text-[28px] font-bold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-2 text-[13px] font-semibold text-ink">{title}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-ink-subtle">{subtitle}</p>}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Job['status'] }) {
  const cfg: Record<Job['status'], { label: string; className: string }> = {
    open:   { label: 'Open',   className: 'bg-indigo-100 text-indigo-700' },
    active: { label: 'Active', className: 'bg-indigo-100 text-indigo-700' },
    closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600'   },
    paused: { label: 'Paused', className: 'bg-amber-100 text-amber-700'   },
    draft:  { label: 'Draft',  className: 'bg-slate-100 text-slate-500'   },
  }
  const { label, className } = cfg[status] ?? cfg.open
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Skeleton helpers
// ---------------------------------------------------------------------------

function SummaryCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-3.5 bg-slate-200 rounded w-28" />
        <div className="w-9 h-9 rounded-lg bg-slate-100" />
      </div>
      <div className="h-8 bg-slate-200 rounded w-12" />
      <div className="h-2.5 bg-slate-100 rounded w-20 mt-2" />
    </div>
  )
}

function TableRowSkeleton() {
  return (
    <tr className="border-b border-slate-50 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-3.5 bg-slate-100 rounded" style={{ width: i === 1 ? '70%' : '50%' }} />
        </td>
      ))}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Result badge for recent activity
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: string | null | undefined }) {
  if (!result) return <span className="text-xs text-slate-400">—</span>
  const cfg: Record<string, string> = {
    pass: 'bg-emerald-100 text-emerald-700',
    fail: 'bg-rose-100 text-rose-700',
    needs_review: 'bg-amber-100 text-amber-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg[result] ?? 'bg-slate-100 text-slate-600'}`}>
      {result === 'needs_review' ? 'Review' : result.charAt(0).toUpperCase() + result.slice(1)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

interface JobStats {
  job: Job
  candidateCount: number
  screened: number
  passedScreening: number
  candidatesLoading: boolean
  screeningLoading: boolean
}

interface RecentActivityItem {
  id: string
  candidateName: string
  jobTitle: string
  result: string | null | undefined
  createdAt: string
}

export default function DashboardPage() {
  // ── Fetch all jobs ────────────────────────────────────────────────────────
  const { data: jobs, isLoading: jobsLoading, isError: jobsError, refetch: refetchJobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
    refetchInterval: 60_000,
  })

  const jobList = jobs ?? []

  // ── Per-job: fetch candidates in parallel ─────────────────────────────────
  const candidateQueries = useQueries({
    queries: jobList.map((job) => ({
      queryKey: ['candidates', job.id],
      queryFn: () => fetchJobCandidates(job.id),
    })),
  })

  // ── Per-job: fetch screening calls in parallel ────────────────────────────
  const screeningQueries = useQueries({
    queries: jobList.map((job) => ({
      queryKey: ['screening', job.id],
      queryFn: () =>
        api.get(`/api/jobs/${job.id}/screening`) as unknown as Promise<ScreeningCall[]>,
    })),
  })

  // ── Build flat candidates map for name lookup ─────────────────────────────
  const allCandidatesMap = useMemo(() => {
    const map: Record<string, Candidate> = {}
    candidateQueries.forEach((q) => {
      ;(q.data ?? []).forEach((c) => { map[c.id] = c })
    })
    return map
  }, [candidateQueries])

  // ── Per-job stats ─────────────────────────────────────────────────────────
  const jobStats = useMemo((): JobStats[] => {
    return jobList.map((job, i) => {
      const candidates = (candidateQueries[i]?.data ?? []) as Candidate[]
      const screeningCalls = (screeningQueries[i]?.data ?? []) as ScreeningCall[]
      // Count unique candidates (retries create multiple completed calls for one person)
      const screenedCandidateIds = new Set(
        screeningCalls
          .filter((sc) => sc.call_status === 'completed')
          .map((sc) => sc.candidate_id),
      )
      const passedCandidateIds = new Set(
        screeningCalls
          .filter((sc) => sc.result === 'pass')
          .map((sc) => sc.candidate_id),
      )
      return {
        job,
        candidateCount: candidates.length,
        screened: screenedCandidateIds.size,
        passedScreening: passedCandidateIds.size,
        candidatesLoading: candidateQueries[i]?.isLoading ?? false,
        screeningLoading: screeningQueries[i]?.isLoading ?? false,
      }
    })
  }, [jobList, candidateQueries, screeningQueries])

  // ── Summary totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const activeJobs = jobList.filter(
      (j) => j.status === 'open' || j.status === 'active',
    ).length
    const totalCandidates = jobStats.reduce((acc, s) => acc + s.candidateCount, 0)
    const totalScreened = jobStats.reduce((acc, s) => acc + s.screened, 0)
    const totalInterviewed = jobStats.reduce((acc, s) => acc + s.passedScreening, 0)
    return { activeJobs, totalCandidates, totalScreened, totalInterviewed }
  }, [jobList, jobStats])

  // ── Recent screening activity (last 5 completed calls across all jobs) ────
  const recentActivity = useMemo((): RecentActivityItem[] => {
    const all: RecentActivityItem[] = []
    jobStats.forEach((s) => {
      const calls = (screeningQueries[jobList.findIndex((j) => j.id === s.job.id)]?.data ?? []) as ScreeningCall[]
      calls
        .filter((sc) => sc.call_status === 'completed')
        .forEach((sc) => {
          const c = allCandidatesMap[sc.candidate_id]
          const candidateName =
            c?.parsed_data?.name ?? c?.name ?? `Candidate …${sc.candidate_id.slice(-4)}`
          all.push({
            id: sc.id,
            candidateName,
            jobTitle: s.job.title,
            result: sc.result,
            createdAt: sc.created_at,
          })
        })
    })
    // Sort by createdAt descending, take last 5
    return all
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
  }, [jobStats, screeningQueries, jobList, allCandidatesMap])

  const anyDataLoading =
    jobsLoading ||
    candidateQueries.some((q) => q.isLoading) ||
    screeningQueries.some((q) => q.isLoading)

  // ── Loading state ─────────────────────────────────────────────────────────
  if (jobsLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <div className="h-7 bg-slate-200 rounded w-36 animate-pulse mb-1" />
          <div className="h-3.5 bg-slate-100 rounded w-64 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SummaryCardSkeleton key={i} />)}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Error banner */}
      {jobsError && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-neg/20 bg-neg-soft px-4 py-3 text-sm text-neg">
          <AlertCircle size={16} className="shrink-0" />
          Failed to load dashboard data.
          <button onClick={() => void refetchJobs()} className="underline ml-1">Retry</button>
        </div>
      )}

      <PageHeader title="Dashboard" subtitle="Pipeline overview across all active jobs" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          title="Active Jobs"
          value={totals.activeJobs}
          icon={<Briefcase size={18} />}
          tone="indigo"
          subtitle={`of ${jobList.length} total`}
          to="/jobs"
        />
        <SummaryCard
          title="Total Candidates"
          value={anyDataLoading ? '…' : totals.totalCandidates}
          icon={<Users size={18} />}
          tone="violet"
          subtitle="across all jobs"
          to="/candidates"
        />
        <SummaryCard
          title="Screened"
          value={anyDataLoading ? '…' : totals.totalScreened}
          icon={<Phone size={18} />}
          tone="emerald"
          subtitle="candidates with a completed call"
          to="/candidates?stage=screening"
        />
        <SummaryCard
          title="Interview Ready"
          value={anyDataLoading ? '…' : totals.totalInterviewed}
          icon={<Video size={18} />}
          tone="amber"
          subtitle="passed screening"
          to="/candidates?stage=interview"
        />
      </div>

      {/* Main content: jobs table + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs table — takes 2/3 */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Jobs Overview"
            icon={<Briefcase size={14} />}
            bodyClassName=""
            action={
              <Link to="/jobs" className={LINK_ACTION}>
                View all <ChevronRight size={13} />
              </Link>
            }
          >
            {jobList.length === 0 ? (
              <EmptyState
                icon={<Briefcase size={22} />}
                title="No jobs yet"
                body="Click + next to Jobs in the sidebar to create your first job."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Job
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Candidates
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Screened
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                        Interviewed
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobStats.map(
                      ({ job, candidateCount, screened, passedScreening, candidatesLoading, screeningLoading }) => (
                        <tr
                          key={job.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors group"
                        >
                          <td className="px-5 py-3.5">
                            <p className="truncate text-sm font-medium text-ink max-w-[180px]">
                              {job.title}
                            </p>
                            {(job.required_skills?.length ?? 0) > 0 && (
                              <p className="text-xs text-slate-400 mt-0.5">
                                {job.required_skills!.slice(0, 2).join(' · ')}
                                {job.required_skills!.length > 2 && ` +${job.required_skills!.length - 2}`}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={job.status} />
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {candidatesLoading ? (
                              <span className="inline-block h-3 w-5 bg-slate-100 rounded animate-pulse" />
                            ) : (
                              <span className="text-sm font-semibold text-slate-700">
                                {candidateCount}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {screeningLoading ? (
                              <span className="inline-block h-3 w-5 bg-slate-100 rounded animate-pulse" />
                            ) : (
                              <span className="text-sm font-semibold text-slate-700">
                                {screened}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {screeningLoading ? (
                              <span className="inline-block h-3 w-5 bg-slate-100 rounded animate-pulse" />
                            ) : (
                              <span className="text-sm font-semibold text-slate-700">
                                {passedScreening}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <Link
                              to={`/jobs/${job.id}`}
                              className="inline-flex items-center gap-0.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                            >
                              View
                              <ChevronRight
                                size={13}
                                className="group-hover:translate-x-0.5 transition-transform"
                              />
                            </Link>
                          </td>
                        </tr>
                      ),
                    )}

                    {/* Skeleton rows while per-job data loads */}
                    {anyDataLoading && jobList.length === 0 && (
                      <>
                        <TableRowSkeleton />
                        <TableRowSkeleton />
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Recent Activity — takes 1/3 */}
        <SectionCard title="Recent Screening" icon={<TrendingUp size={14} />} bodyClassName="">
          {recentActivity.length === 0 ? (
            <EmptyState
              icon={<Phone size={20} />}
              title="No activity yet"
              body="Completed screening calls will appear here."
            />
          ) : (
            <div className="divide-y divide-line">
              {recentActivity.map((item) => (
                <div key={item.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.candidateName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">{item.jobTitle}</p>
                  </div>
                  <ResultBadge result={item.result} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
