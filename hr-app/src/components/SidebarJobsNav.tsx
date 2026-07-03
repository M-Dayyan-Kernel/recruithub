import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { cn } from '@/lib/utils'

const JOB_PHASES = [
  { label: 'AI Shortlist', segment: '' },
  { label: 'Screening', segment: 'screening' },
  { label: 'Interviews', segment: 'interviews' },
] as const

interface Props {
  onNavigate?: () => void
}

function jobPhasePath(jobId: string, segment: string): string {
  return segment ? `/jobs/${jobId}/${segment}` : `/jobs/${jobId}`
}

function isPhaseActive(pathname: string, jobId: string, segment: string): boolean {
  const base = `/jobs/${jobId}`
  if (segment === '') {
    return pathname === base || pathname === `${base}/`
  }
  return pathname.startsWith(`${base}/${segment}`)
}

export function SidebarJobsNav({ onNavigate }: Props) {
  const location = useLocation()
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())

  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const activeJobId = useMemo(() => {
    const match = location.pathname.match(/^\/jobs\/([^/]+)/)
    const id = match?.[1]
    return id && id !== 'new' ? id : null
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

      {!isLoading && (!jobs || jobs.length === 0) && (
        <p className="px-3 py-2 text-xs text-slate-500">No jobs yet</p>
      )}

      {jobs?.map((job) => {
        const isExpanded = expandedJobs.has(job.id)
        const isCurrentJob = activeJobId === job.id

        return (
          <div key={job.id} className="space-y-0.5">
            <button
              type="button"
              onClick={() => toggleJob(job.id)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                isCurrentJob
                  ? 'text-slate-100'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
              )}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{job.title}</span>
            </button>

            {isExpanded && (
              <div className="ml-4 space-y-0.5 border-l border-slate-700 pl-2">
                {JOB_PHASES.map(({ label, segment }) => (
                  <NavLink
                    key={segment || 'shortlist'}
                    to={jobPhasePath(job.id, segment)}
                    end={segment === ''}
                    onClick={handleLinkClick}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        isActive ||
                          isPhaseActive(location.pathname, job.id, segment)
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
