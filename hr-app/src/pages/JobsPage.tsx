import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Briefcase, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { CreateJobModal } from '@/components/CreateJobModal'
import { BackendError } from '@/components/BackendError'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Job['status'] }) {
  const cfg: Record<Job['status'], { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-indigo-100 text-indigo-700' },
    active: { label: 'Active', className: 'bg-indigo-100 text-indigo-700' },
    closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600' },
    paused: { label: 'Paused', className: 'bg-amber-100 text-amber-700' },
    draft: { label: 'Draft', className: 'bg-slate-100 text-slate-500' },
  }
  const { label, className } = cfg[status] ?? cfg.open
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-50">
      {[1, 2, 3, 4, 5].map(i => (
        <td key={i} className="px-5 py-4">
          <div className="h-4 bg-slate-200 rounded animate-pulse" style={{ width: i === 1 ? '60%' : i === 5 ? '40%' : '50%' }} />
        </td>
      ))}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="py-20 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
        <Briefcase size={28} className="text-indigo-400" />
      </div>
      <p className="text-slate-700 font-medium mb-1">No jobs yet</p>
      <p className="text-slate-400 text-sm mb-5">Create your first job to get started.</p>
      <button
        onClick={onCreateClick}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <Plus size={16} />
        Create Job
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function JobsPage() {
  const [showCreate, setShowCreate] = useState(false)

  const { data: jobs, isLoading, isError, refetch } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
    refetchInterval: 30_000,
  })

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {showCreate && <CreateJobModal onClose={() => setShowCreate(false)} />}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your open positions and recruitment pipelines</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Create New Job
        </button>
      </div>

      {/* Error state */}
      {isError && <BackendError onRetry={refetch} />}

      {/* Table card */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Title
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Candidates
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Created
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Loading skeleton */}
            {isLoading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {/* Loaded jobs */}
            {!isLoading && !isError && jobs && jobs.length > 0 &&
              jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors group">
                  {/* Title */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <Briefcase size={14} className="text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{job.title}</p>
                        {(job.required_skills?.length ?? 0) > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {job.required_skills.slice(0, 3).join(' · ')}
                            {job.required_skills.length > 3 && ` +${job.required_skills.length - 3}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-5 py-4">
                    <StatusBadge status={job.status} />
                  </td>

                  {/* Candidates — backend doesn't return count yet; show dash gracefully */}
                  <td className="px-5 py-4 text-sm text-slate-600">
                    {'candidate_count' in job
                      ? (job as Job & { candidate_count: number }).candidate_count
                      : '—'}
                  </td>

                  {/* Created */}
                  <td className="px-5 py-4 text-sm text-slate-500">
                    {formatDate(job.created_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-4">
                    <Link
                      to={`/jobs/${job.id}`}
                      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      View
                      <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>

        {/* Empty state — inside card, below thead */}
        {!isLoading && !isError && jobs && jobs.length === 0 && (
          <EmptyState onCreateClick={() => setShowCreate(true)} />
        )}
      </div>
    </div>
  )
}
