import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Loader2,
  Lock,
  MapPin,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { EditJobModal } from '@/components/EditJobModal'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { RequiredSkills } from '@/components/job/RequiredSkills'
import { VoiceScreeningToggle } from '@/components/screening/VoiceScreeningToggle'
import { ExtensionCheckToggle } from '@/components/job/ExtensionCheckToggle'
import { cn } from '@/lib/utils'
import {
  closeJobConfirmBody,
  jobStatusErrorToast,
  jobStatusToast,
  type JobCloseImpact,
} from '@/lib/jobActionMessages'
import { isJobEditable } from '@/lib/jobStatus'
import { duplicateJobPath } from '@/lib/jobDuplicate'
import { workArrangementLabel } from '@/lib/screeningQuestions'
import { seniorityLabel } from '@/lib/seniority'
import { errorMessage } from '@/lib/errorMessage'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

const DESCRIPTION_PREVIEW_LINES = 3

export function JobHeaderSkeleton() {
  return (
    <div className="mb-6 animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-5">
        <div className="h-7 w-2/5 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-1/4 rounded bg-slate-100" />
      </div>
      <div className="space-y-3 px-6 py-4">
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-5/6 rounded bg-slate-100" />
        <div className="flex gap-2">
          <div className="h-6 w-16 rounded-full bg-slate-100" />
          <div className="h-6 w-20 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

type StatusOption = { label: string; hint?: string; icon: LucideIcon } & (
  | { kind: 'status'; value: Job['status'] }
  | { kind: 'duplicate' }
)

/**
 * Pause is the safe choice (nothing is lost, reactivate any time), so it says so. Close is
 * final; a closed job's only way forward is a new job copied from it.
 */
function getStatusOptions(status: Job['status']): StatusOption[] {
  const close: StatusOption = {
    kind: 'status',
    label: 'Close job',
    hint: "Ends hiring · can't be undone",
    icon: Lock,
    value: 'closed',
  }
  switch (status) {
    case 'open':
    case 'active':
      return [
        { kind: 'status', label: 'Pause job', hint: 'Holds new activity · reactivate any time', icon: Pause, value: 'paused' },
        close,
      ]
    case 'paused':
      return [{ kind: 'status', label: 'Reactivate', icon: Play, value: 'open' }, close]
    case 'closed':
      return [{ kind: 'duplicate', label: 'Duplicate as new job', hint: 'Hire for this role again', icon: CopyPlus }]
    default:
      return [{ kind: 'status', label: 'Publish', icon: Send, value: 'open' }]
  }
}

const menuItem =
  'flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50'

interface Props {
  job: Job
  showDelete?: boolean
}

export function JobHeader({ job, showDelete = false }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const skills = job.required_skills ?? []
  const description = job.description?.trim() || 'No description provided.'
  const isLongDescription = description.length > 220 || description.split('\n').length > DESCRIPTION_PREVIEW_LINES
  const levelLabel = seniorityLabel(job.seniority_level)
  const workLabel = workArrangementLabel(job.work_mode, job.work_location)

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
    onSuccess: (_job, status) => {
      if (status === 'closed') {
        // Closing cancelled calls and interview links across this job's tabs; refetch them all.
        queryClient.invalidateQueries()
      } else {
        queryClient.invalidateQueries({ queryKey: ['job', job.id] })
        queryClient.invalidateQueries({ queryKey: ['jobs'] })
      }
      // `job.status` is still the status it moved from: the query refetches after this runs.
      toast.success(jobStatusToast(job.status, status))
      setShowStatusMenu(false)
    },
    onError: (err, status) => {
      // Closing runs from its confirm dialog, which shows the refusal in place.
      if (status === 'closed') return
      toast.error(errorMessage(err, jobStatusErrorToast(job.status, status)))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/jobs/${job.id}`) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.removeQueries({ queryKey: ['job', job.id] })
      toast.success('Job deleted')
      navigate('/jobs')
    },
    // Refusals show inside the delete dialog (runConfirmed), not as a toast behind it.
  })

  // Closing and deleting ask first, in the app's own dialog, which also shows the server's
  // reason in place if it refuses. Pause and reactivate are one click: both are undone the
  // same way they were done.
  const [confirming, setConfirming] = useState<'close' | 'delete' | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  // What closing would cancel, fetched when the dialog opens so the figures are current.
  const { data: closeImpact } = useQuery<JobCloseImpact>({
    queryKey: ['job', job.id, 'close-impact'],
    queryFn: () => api.get(`/api/jobs/${job.id}/close-impact`) as unknown as Promise<JobCloseImpact>,
    enabled: confirming === 'close',
    staleTime: 0,
    gcTime: 0,
  })
  const editable = isJobEditable(job.status)

  const openConfirm = (kind: 'close' | 'delete') => {
    setShowStatusMenu(false)
    setConfirmError(null)
    setConfirming(kind)
  }

  const closeConfirm = () => {
    setConfirming(null)
    setConfirmError(null)
  }

  const handleDelete = () => openConfirm('delete')

  const runConfirmed = () => {
    if (confirming === 'delete') {
      deleteMutation.mutate(undefined, {
        onError: (err) => setConfirmError(errorMessage(err, 'Failed to delete job')),
      })
    } else if (confirming === 'close') {
      statusMutation.mutate('closed', {
        onSuccess: closeConfirm,
        onError: (err) =>
          setConfirmError(errorMessage(err, jobStatusErrorToast(job.status, 'closed'))),
      })
    }
  }

  const isActionPending =
    statusMutation.isPending || deleteMutation.isPending

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="rounded-t-2xl border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                  {job.title}
                </h1>
                <JobStatusBadge status={job.status} />
              </div>

              {(levelLabel || workLabel) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {workLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      {workLabel}
                    </span>
                  )}
                  {levelLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80">
                      <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                      {levelLabel}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              {/* The two per-job settings, grouped apart from the actions menu beside them.
                  A closed job is read-only, so they are not offered there. */}
              {editable && (
                <>
                  <div className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 p-1">
                    <VoiceScreeningToggle job={job} variant="icon" />
                    <ExtensionCheckToggle job={job} variant="icon" />
                  </div>
                  <span aria-hidden className="h-6 w-px bg-line" />
                </>
              )}

              <div className="relative" ref={statusMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowStatusMenu((v) => !v)}
                  disabled={isActionPending}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
                  aria-label="Job actions"
                  title="Job actions"
                  aria-expanded={showStatusMenu}
                  aria-haspopup="menu"
                >
                  {isActionPending ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <MoreVertical size={16} aria-hidden />
                  )}
                </button>
                {showStatusMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-20 mt-1 min-w-[17rem] rounded-lg border border-line bg-surface py-1 shadow-lg"
                  >
                    {editable && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowStatusMenu(false)
                          setEditOpen(true)
                        }}
                        className={cn(menuItem, 'text-ink hover:bg-surface-2')}
                      >
                        <Pencil size={14} aria-hidden />
                        Edit
                      </button>
                    )}
                    {getStatusOptions(job.status).map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (opt.kind === 'duplicate') {
                            setShowStatusMenu(false)
                            navigate(duplicateJobPath(job.id))
                          } else if (opt.value === 'closed') {
                            openConfirm('close')
                          } else {
                            statusMutation.mutate(opt.value)
                          }
                        }}
                        disabled={isActionPending}
                        className={cn(menuItem, 'items-start text-ink hover:bg-surface-2')}
                      >
                        <opt.icon size={14} className="mt-0.5 shrink-0" aria-hidden />
                        <span className="flex flex-col">
                          <span>{opt.label}</span>
                          {opt.hint && <span className="text-[11px] text-ink-subtle">{opt.hint}</span>}
                        </span>
                      </button>
                    ))}
                    {showDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowStatusMenu(false)
                          handleDelete()
                        }}
                        disabled={isActionPending}
                        className={cn(menuItem, 'mt-1 border-t border-line text-neg hover:bg-neg-soft')}
                      >
                        <Trash2 size={14} aria-hidden />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4 sm:px-6">
          <div>
            <p
              className={cn(
                'text-sm leading-relaxed text-slate-600 whitespace-pre-line',
                !descriptionExpanded && isLongDescription && 'line-clamp-3',
              )}
            >
              {description}
            </p>
            {isLongDescription && (
              <button
                type="button"
                onClick={() => setDescriptionExpanded((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                {descriptionExpanded ? (
                  <>
                    Show less
                    <ChevronUp size={14} />
                  </>
                ) : (
                  <>
                    Show full description
                    <ChevronDown size={14} />
                  </>
                )}
              </button>
            )}
          </div>

          <RequiredSkills skills={skills} />
        </div>
      </div>

      {editOpen && editable && (
        <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
      )}

      {confirming === 'close' && (
        <ConfirmDialog
          title={`Close "${job.title}"?`}
          body={closeJobConfirmBody(closeImpact)}
          confirmLabel="Close job"
          busy={statusMutation.isPending}
          error={confirmError}
          onConfirm={runConfirmed}
          onClose={closeConfirm}
        />
      )}

      {confirming === 'delete' && (
        <ConfirmDialog
          title={`Delete "${job.title}"?`}
          body="This permanently removes the job and all its candidates, shortlist results, screening calls and interviews. It cannot be undone."
          confirmLabel="Delete job"
          busy={deleteMutation.isPending}
          error={confirmError}
          onConfirm={runConfirmed}
          onClose={closeConfirm}
        />
      )}
    </>
  )
}
