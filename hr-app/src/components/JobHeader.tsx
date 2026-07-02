import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronDown, Loader2, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { EditJobModal } from '@/components/EditJobModal'

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
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

export function JobHeaderSkeleton() {
  return (
    <div className="mb-6 animate-pulse rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 h-7 w-1/3 rounded bg-slate-200" />
      <div className="mb-4 h-4 w-1/5 rounded bg-slate-200" />
      <div className="mb-2 h-4 w-full rounded bg-slate-200" />
      <div className="mb-4 h-4 w-4/5 rounded bg-slate-200" />
      <div className="flex gap-2">
        <div className="h-6 w-16 rounded-full bg-slate-200" />
        <div className="h-6 w-20 rounded-full bg-slate-200" />
      </div>
    </div>
  )
}

function getStatusOptions(
  status: Job['status'],
): Array<{ label: string; value: Job['status'] }> {
  switch (status) {
    case 'open':
    case 'active':
      return [
        { label: 'Pause Job', value: 'paused' },
        { label: 'Close Job', value: 'closed' },
      ]
    case 'paused':
      return [
        { label: 'Reactivate', value: 'open' },
        { label: 'Close Job', value: 'closed' },
      ]
    case 'closed':
      return [{ label: 'Reactivate', value: 'open' }]
    default:
      return [{ label: 'Publish', value: 'open' }]
  }
}

function experienceLabel(job: Job): string | null {
  const { experience_min: min, experience_max: max } = job
  if (min != null && max != null) return `${min}–${max} years`
  if (min != null) return `${min}+ years`
  if (max != null) return `Up to ${max} years`
  return null
}

interface Props {
  job: Job
}

export function JobHeader({ job }: Props) {
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
      }
    }
    if (showStatusMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStatusMenu])

  const statusMutation = useMutation<Job, Error, Job['status']>({
    mutationFn: (status) =>
      api.patch(`/api/jobs/${job.id}`, { status }) as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job status updated')
      setShowStatusMenu(false)
    },
    onError: () => {
      toast.error('Failed to update job status')
    },
  })

  const expLabel = experienceLabel(job)

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
              <StatusBadge status={job.status} />
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                title="Edit job"
              >
                <Pencil size={15} />
              </button>
            </div>
            <div className="relative mb-3 inline-block" ref={statusMenuRef}>
              <button
                type="button"
                onClick={() => setShowStatusMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                {statusMutation.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ChevronDown size={13} />
                )}
                Change Status
              </button>
              {showStatusMenu && (
                <div className="absolute left-0 top-full z-20 mt-1 min-w-[150px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {getStatusOptions(job.status).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => statusMutation.mutate(opt.value)}
                      disabled={statusMutation.isPending}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {expLabel && (
              <p className="mb-3 text-sm text-slate-500">{expLabel} experience required</p>
            )}

            <p className="mb-4 text-sm leading-relaxed text-slate-600">{job.description}</p>

            {(job.required_skills?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {job.required_skills!.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editOpen && (
        <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}
