import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { EditJobModal } from '@/components/EditJobModal'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { VoiceScreeningToggle } from '@/components/screening/VoiceScreeningToggle'
import { ExtensionCheckToggle } from '@/components/job/ExtensionCheckToggle'
import { cn } from '@/lib/utils'
import { jobStatusErrorToast, jobStatusToast } from '@/lib/jobActionMessages'
import { workArrangementLabel } from '@/lib/screeningQuestions'
import { seniorityLabel } from '@/lib/seniority'

const DESCRIPTION_PREVIEW_LINES = 3
const SKILL_PREVIEW_COUNT = 8

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

function getStatusOptions(
  status: Job['status'],
): Array<{ label: string; value: Job['status'] }> {
  switch (status) {
    case 'open':
    case 'active':
      return [
        { label: 'Pause job', value: 'paused' },
        { label: 'Close job', value: 'closed' },
      ]
    case 'paused':
      return [
        { label: 'Reactivate', value: 'open' },
        { label: 'Close job', value: 'closed' },
      ]
    case 'closed':
      return [{ label: 'Reactivate', value: 'open' }]
    default:
      return [{ label: 'Publish', value: 'open' }]
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
  const [skillsExpanded, setSkillsExpanded] = useState(false)
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
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      // `job.status` is still the status it moved from: the query refetches after this runs.
      toast.success(jobStatusToast(job.status, status))
      setShowStatusMenu(false)
    },
    onError: (_err, status) => {
      toast.error(jobStatusErrorToast(job.status, status))
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
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete job')
    },
  })

  const handleDelete = () => {
    const confirmed = window.confirm(
      `Delete "${job.title}"? This will permanently remove the job and all candidates, shortlist results, screening calls, and interviews.`,
    )
    if (confirmed) deleteMutation.mutate()
  }

  const isActionPending =
    statusMutation.isPending || deleteMutation.isPending
  const visibleSkills = skillsExpanded ? skills : skills.slice(0, SKILL_PREVIEW_COUNT)
  const hiddenSkillCount = skills.length - SKILL_PREVIEW_COUNT

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
              {/* The two per-job settings, grouped apart from the actions menu beside them. */}
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 p-1">
                <VoiceScreeningToggle job={job} variant="icon" />
                <ExtensionCheckToggle job={job} variant="icon" />
              </div>
              <span aria-hidden className="h-6 w-px bg-line" />

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
                    className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-lg border border-line bg-surface py-1 shadow-lg"
                  >
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
                    {getStatusOptions(job.status).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="menuitem"
                        onClick={() => statusMutation.mutate(opt.value)}
                        disabled={isActionPending}
                        className={cn(menuItem, 'pl-[2.4rem] text-ink hover:bg-surface-2')}
                      >
                        {opt.label}
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

          {skills.length > 0 && (
            <div
              // Hover or keyboard focus reveals every skill; leaving folds it back. Nothing to click.
              onMouseEnter={() => setSkillsExpanded(true)}
              onMouseLeave={() => setSkillsExpanded(false)}
              onFocus={() => setSkillsExpanded(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSkillsExpanded(false)
              }}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Required skills
              </p>
              <div className="flex flex-wrap gap-1.5">
                {visibleSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                  >
                    {skill}
                  </span>
                ))}
                {!skillsExpanded && hiddenSkillCount > 0 && (
                  // Still a button so touch and keyboard users can open it; hover does the same.
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded(true)}
                    aria-label={`Show ${hiddenSkillCount} more required skills`}
                    className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-500"
                  >
                    +{hiddenSkillCount} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}
