import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, SystemSettings } from '@/types/api'
import { cn } from '@/lib/utils'
import { filterActiveJobs } from '@/lib/jobStatus'

const JOB_PHASES = [
  { label: 'AI Shortlist', segment: 'shortlist' },
  { label: 'Screening', segment: 'screening' },
  { label: 'Interviews', segment: 'interviews' },
  { label: 'Finalists', segment: 'finalists' },
] as const

interface Props {
  onNavigate?: () => void
}

function jobDetailsPath(jobId: string): string {
  return `/jobs/${jobId}`
}

function jobPhasePath(jobId: string, segment: string): string {
  return `/jobs/${jobId}/${segment}`
}

function isJobDetailsActive(pathname: string, jobId: string): boolean {
  const base = `/jobs/${jobId}`
  return pathname === base || pathname === `${base}/`
}

function isPhaseActive(pathname: string, jobId: string, segment: string): boolean {
  return pathname === jobPhasePath(jobId, segment) || pathname.startsWith(`${jobPhasePath(jobId, segment)}/`)
}

export function SidebarJobsNav({ onNavigate }: Props) {
  const location = useLocation()
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())

  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const jobPhases = useMemo(() => {
    if (settings?.screening_enabled === false) {
      return JOB_PHASES.filter((phase) => phase.segment !== 'screening')
    }
    return JOB_PHASES
  }, [settings?.screening_enabled])

  const activeJobs = useMemo(() => filterActiveJobs(jobs ?? []), [jobs])

  const activeJobId = useMemo(() => {
    const match = location.pathname.match(/^\/jobs\/([^/]+)/)
    const id = match?.[1]
    return id && id !== 'new' && id !== 'archived' ? id : null
  }, [location.pathname])

  useEffect(() => {
    if (activeJobId) {
      setExpandedJobs((prev) => new Set(prev).add(activeJobId))
    }
  }, [activeJobId])

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const expandJob = (jobId: string) => {
    setExpandedJobs((prev) => new Set(prev).add(jobId))
  }

  const handleLinkClick = () => {
    onNavigate?.()
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Briefcase className="h-3.5 w-3.5 shrink-0" />
          Jobs
        </div>
        <Link
          to="/jobs/new"
          aria-label="Create Job"
          onClick={handleLinkClick}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
        >
          <Plus className="h-4 w-4" />
        </Link>
      </div>

      {isLoading && (
        <p className="px-3 py-2 text-xs text-slate-500">Loading jobs…</p>
      )}

      {!isLoading && activeJobs.length === 0 && (
        <p className="px-3 py-2 text-xs text-slate-500">No active jobs</p>
      )}

      {activeJobs.map((job) => {
        const isExpanded = expandedJobs.has(job.id)
        const isCurrentJob = activeJobId === job.id
        const detailsActive = isJobDetailsActive(location.pathname, job.id)

        return (
          <div key={job.id} className="space-y-0.5">
            <div
              className={cn(
                'flex w-full items-center gap-0.5 rounded-lg px-1 py-1 transition-colors',
                isCurrentJob && 'bg-slate-800/40',
              )}
            >
              <button
                type="button"
                onClick={() => toggleJob(job.id)}
                aria-label={isExpanded ? `Collapse ${job.title}` : `Expand ${job.title}`}
                aria-expanded={isExpanded}
                className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <Link
                to={jobDetailsPath(job.id)}
                onClick={() => {
                  expandJob(job.id)
                  handleLinkClick()
                }}
                title="Job details"
                className={cn(
                  'min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-sm transition-colors',
                  detailsActive
                    ? 'bg-indigo-600 font-medium text-white'
                    : isCurrentJob
                      ? 'text-slate-100 hover:bg-slate-800'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                )}
              >
                {job.title}
              </Link>
            </div>

            {isExpanded && (
              <div className="ml-4 space-y-0.5 border-l border-slate-700 pl-2">
                {jobPhases.map(({ label, segment }) => (
                  <NavLink
                    key={segment}
                    to={jobPhasePath(job.id, segment)}
                    onClick={handleLinkClick}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        isActive || isPhaseActive(location.pathname, job.id, segment)
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
