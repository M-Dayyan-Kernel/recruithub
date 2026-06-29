import { useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'

interface Props {
  job: Job
  open: boolean
  onClose: () => void
}

export function EditJobModal({ job, open, onClose }: Props) {
  const queryClient = useQueryClient()

  const [title, setTitle] = useState(job.title)
  const [description, setDescription] = useState(job.description)
  const [skills, setSkills] = useState<string[]>(job.required_skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [minExp, setMinExp] = useState(job.experience_min != null ? String(job.experience_min) : '')
  const [maxExp, setMaxExp] = useState(job.experience_max != null ? String(job.experience_max) : '')
  const [screeningCriteria, setScreeningCriteria] = useState(job.screening_criteria ?? '')
  const [interviewCriteria, setInterviewCriteria] = useState(
    job.interview_evaluation_criteria ?? '',
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch(`/api/jobs/${job.id}`, payload) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job updated')
      onClose()
    },
    onError: (err: Error) => {
      setSubmitError(err.message ?? 'Failed to update job. Please try again.')
      toast.error('Failed to update job')
    },
  })

  const addSkill = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, '').trim()
    if (trimmed && !skills.includes(trimmed)) {
      setSkills((prev) => [...prev, trimmed])
    }
    setSkillInput('')
  }

  const handleSkillKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addSkill(skillInput)
    }
    if (e.key === 'Backspace' && !skillInput && skills.length > 0) {
      setSkills((prev) => prev.slice(0, -1))
    }
  }

  const removeSkill = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill))
  }

  const handleSubmit = () => {
    if (!title.trim()) {
      setSubmitError('Job title is required')
      return
    }
    if (!description.trim()) {
      setSubmitError('Description is required')
      return
    }
    setSubmitError(null)

    // Flush any pending skill input
    const finalSkills = [...skills]
    if (skillInput.trim()) {
      const trimmed = skillInput.trim()
      if (!finalSkills.includes(trimmed)) finalSkills.push(trimmed)
    }

    // Build changed-fields-only payload
    const payload: Record<string, unknown> = {}
    if (title.trim() !== job.title) payload.title = title.trim()
    if (description.trim() !== job.description) payload.description = description.trim()

    const origSkills = JSON.stringify(job.required_skills ?? [])
    if (origSkills !== JSON.stringify(finalSkills)) payload.required_skills = finalSkills

    const newMin = minExp ? Number(minExp) : undefined
    const newMax = maxExp ? Number(maxExp) : undefined
    if (newMin !== job.experience_min) payload.experience_min = newMin ?? null
    if (newMax !== job.experience_max) payload.experience_max = newMax ?? null

    const origScreening = job.screening_criteria ?? ''
    const origInterview = job.interview_evaluation_criteria ?? ''
    if (screeningCriteria.trim() !== origScreening)
      payload.screening_criteria = screeningCriteria.trim() || null
    if (interviewCriteria.trim() !== origInterview)
      payload.interview_evaluation_criteria = interviewCriteria.trim() || null

    if (Object.keys(payload).length === 0) {
      toast('No changes to save')
      onClose()
      return
    }

    mutation.mutate(payload)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-slate-100 z-10">
          <h2 className="text-lg font-semibold text-slate-900">Edit Job</h2>
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="px-6 py-5 space-y-5">
          {submitError && (
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
              <AlertCircle size={15} className="text-rose-500 mt-0.5 shrink-0" />
              <p className="text-sm text-rose-700">{submitError}</p>
            </div>
          )}

          {/* Job Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Job Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setSubmitError(null)
              }}
              placeholder="e.g. Senior Frontend Engineer"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Description <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setSubmitError(null)
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Required Skills — Chip input (same pattern as CreateJobModal) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Required Skills
            </label>
            <div className="border border-slate-200 rounded-lg p-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent min-h-[44px]">
              <div className="flex flex-wrap gap-1.5 mb-1">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="hover:text-indigo-900 ml-0.5 leading-none"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                onBlur={() => {
                  if (skillInput.trim()) addSkill(skillInput)
                }}
                placeholder={
                  skills.length === 0 ? 'Type a skill and press Enter or comma to add...' : ''
                }
                className="w-full text-sm focus:outline-none placeholder:text-slate-400"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Press Enter or comma to add a skill chip
            </p>
          </div>

          {/* Experience Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Min Experience (years)
              </label>
              <input
                type="number"
                min={0}
                value={minExp}
                onChange={(e) => setMinExp(e.target.value)}
                placeholder="e.g. 3"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Max Experience (years)
              </label>
              <input
                type="number"
                min={0}
                value={maxExp}
                onChange={(e) => setMaxExp(e.target.value)}
                placeholder="e.g. 6"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Screening Criteria */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Screening Criteria
            </label>
            <textarea
              rows={3}
              value={screeningCriteria}
              onChange={(e) => setScreeningCriteria(e.target.value)}
              placeholder="e.g. Must have 3+ years Python, Must be available in 2 weeks..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Interview Evaluation Criteria */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Interview Evaluation Criteria
            </label>
            <textarea
              rows={3}
              value={interviewCriteria}
              onChange={(e) => setInterviewCriteria(e.target.value)}
              placeholder="e.g. Assess problem-solving, system design, communication..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditJobModal
