import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import {
  Briefcase,
  Users,
  Phone,
  Video,
  ChevronRight,
  TrendingUp,
  AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, Candidate, ScreeningCall } from '@/types/api'

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  iconBg: string
  subtitle?: string
}

function SummaryCard({ title, value, icon, iconBg, subtitle }: SummaryCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
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
      queryFn: () =>
        api.get(`/api/jobs/${job.id}/candidates`) as unknown as Promise<Candidate[]>,
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
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700 mb-6">
          <AlertCircle size={16} className="shrink-0" />
          Failed to load dashboard data.
          <button onClick={() => void refetchJobs()} className="underline ml-1">Retry</button>
        </div>
      )}

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Pipeline overview across all active jobs
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          title="Active Jobs"
          value={totals.activeJobs}
          icon={<Briefcase size={17} className="text-indigo-600" />}
          iconBg="bg-indigo-50"
          subtitle={`of ${jobList.length} total`}
        />
        <SummaryCard
          title="Total Candidates"
          value={anyDataLoading ? '…' : totals.totalCandidates}
          icon={<Users size={17} className="text-violet-600" />}
          iconBg="bg-violet-50"
          subtitle="across all jobs"
        />
        <SummaryCard
          title="Screened"
          value={anyDataLoading ? '…' : totals.totalScreened}
          icon={<Phone size={17} className="text-emerald-600" />}
          iconBg="bg-emerald-50"
          subtitle="candidates with a completed call"
        />
        <SummaryCard
          title="Interview Ready"
          value={anyDataLoading ? '…' : totals.totalInterviewed}
          icon={<Video size={17} className="text-amber-600" />}
          iconBg="bg-amber-50"
          subtitle="passed screening"
        />
      </div>

      {/* Main content: jobs table + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs table — takes 2/3 */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Jobs Overview</h2>
            </div>

            {jobList.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
                  <Briefcase size={22} className="text-indigo-400" />
                </div>
                <p className="text-slate-600 font-medium mb-1">No jobs yet</p>
                <p className="text-slate-400 text-sm mb-4">
                  Click + next to Jobs in the sidebar to create your first job.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Job
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Candidates
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Screened
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
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
                            <p className="text-sm font-medium text-slate-800 truncate max-w-[180px]">
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
          </div>
        </div>

        {/* Recent Activity — takes 1/3 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp size={15} className="text-slate-400" />
            <h2 className="font-semibold text-slate-800">Recent Screening</h2>
          </div>

          {recentActivity.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center px-4">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Phone size={18} className="text-slate-300" />
              </div>
              <p className="text-slate-500 text-sm font-medium">No activity yet</p>
              <p className="text-slate-400 text-xs mt-1">
                Completed screening calls will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {recentActivity.map((item) => (
                <div key={item.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.candidateName}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{item.jobTitle}</p>
                  </div>
                  <ResultBadge result={item.result} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
