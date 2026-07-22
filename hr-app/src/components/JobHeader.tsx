import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { EditJobModal } from '@/components/EditJobModal'
import { JobStatusBadge } from '@/components/JobStatusBadge'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import { cn } from '@/lib/utils'

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

function experienceLabel(job: Job): string | null {
  const { experience_min: min, experience_max: max } = job
  const hasMin = min != null && min > 0
  const hasMax = max != null && max > 0

  if (hasMin && hasMax) {
    if (min === max) return `${min} yrs experience`
    if (min > max) return `${min}+ yrs experience`
    return `${min}–${max} yrs experience`
  }
  if (hasMin) return `${min}+ yrs experience`
  if (hasMax) return `Up to ${max} yrs experience`
  return null
}

const btnSecondary =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50'

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
  const [jobScreeningOn, setJobScreeningOn] = useState(job.voice_screening_enabled !== false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const skills = job.required_skills ?? []
  const description = job.description?.trim() || 'No description provided.'
  const isLongDescription = description.length > 220 || description.split('\n').length > DESCRIPTION_PREVIEW_LINES
  const expLabel = experienceLabel(job)

  useEffect(() => {
    setJobScreeningOn(job.voice_screening_enabled !== false)
  }, [job.voice_screening_enabled])

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

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/jobs/${job.id}`) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.removeQueries({ queryKey: ['job', job.id] })
      toast.success('Job deleted')
      navigate('/jobs')
    },
    onError: () => {
      toast.error('Failed to delete job')
    },
  })

  const screeningToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch(`/api/jobs/${job.id}`, {
        voice_screening_enabled: enabled,
      }) as Promise<Job>,
    onMutate: (enabled) => {
      setJobScreeningOn(enabled)
    },
    onSuccess: (updatedJob, enabled) => {
      const merged = { ...updatedJob, voice_screening_enabled: enabled }
      queryClient.setQueryData(['job', job.id], merged)
      setJobScreeningOn(enabled)
      toast.success(enabled ? 'Voice screening on' : 'Voice screening off')
    },
    onError: () => {
      setJobScreeningOn(job.voice_screening_enabled !== false)
      toast.error('Failed to update voice screening setting')
    },
  })

  const handleDelete = () => {
    const confirmed = window.confirm(
      `Delete "${job.title}"? This will permanently remove the job and all candidates, shortlist results, screening calls, and interviews.`,
    )
    if (confirmed) deleteMutation.mutate()
  }

  const isActionPending =
    statusMutation.isPending || deleteMutation.isPending || screeningToggleMutation.isPending
  const visibleSkills = skillsExpanded ? skills : skills.slice(0, SKILL_PREVIEW_COUNT)
  const hiddenSkillCount = skills.length - SKILL_PREVIEW_COUNT

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                  {job.title}
                </h1>
                <JobStatusBadge status={job.status} />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {expLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80">
                      <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                      {expLabel}
                    </span>
                  )}
                  {skills.length > 0 && (
                    <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200/80">
                      {skills.length} required skill{skills.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <VoiceScreeningSwitch
                  checked={jobScreeningOn}
                  disabled={screeningToggleMutation.isPending}
                  onChange={(enabled) => screeningToggleMutation.mutate(enabled)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className={btnSecondary}
              >
                <Pencil size={14} />
                Edit
              </button>

              <div className="relative" ref={statusMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowStatusMenu((v) => !v)}
                  disabled={isActionPending}
                  className={btnSecondary}
                  aria-expanded={showStatusMenu}
                  aria-haspopup="menu"
                >
                  {statusMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  Status
                </button>
                {showStatusMenu && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {getStatusOptions(job.status).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => statusMutation.mutate(opt.value)}
                        disabled={isActionPending}
                        className="w-full px-3.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isActionPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  Delete
                </button>
              )}
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
            <div>
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
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded(true)}
                    className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
                  >
                    +{hiddenSkillCount} more
                  </button>
                )}
                {skillsExpanded && skills.length > SKILL_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded(false)}
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Show fewer
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
