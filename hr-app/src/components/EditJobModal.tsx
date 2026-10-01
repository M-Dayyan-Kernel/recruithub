import { useEffect, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { RequiredMark } from '@/components/FieldError'
import type { Job, InterviewQuestion, ScreeningQuestion } from '@/types/api'
import { InterviewQuestionsEditor } from '@/components/InterviewQuestionsEditor'
import { ScreeningQuestionsEditor } from '@/components/ScreeningQuestionsEditor'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import { getDefaultScreeningQuestions } from '@/lib/screeningDefaults'
import {
  EXPERIENCE_MAX_YEARS,
  sanitizeYearsInput,
  validateExperienceRange,
} from '@/lib/validation'

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
  const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>(
    job.screening_questions?.length
      ? job.screening_questions
      : getDefaultScreeningQuestions(job.title),
  )
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>(
    job.interview_questions ?? [],
  )
  const [voiceScreeningEnabled, setVoiceScreeningEnabled] = useState(
    job.voice_screening_enabled !== false,
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Voice screening needs at least one question to ask.
  const missingScreeningQuestions =
    voiceScreeningEnabled && !screeningQuestions.some((q) => q.question.trim())

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
    const expError = validateExperienceRange(minExp, maxExp)
    if (expError) {
      setSubmitError(expError.message)
      return
    }
    if (voiceScreeningEnabled && !screeningQuestions.some((q) => q.question.trim())) {
      setSubmitError('Add at least one screening question, or turn voice screening off')
      return
    }
    // Blank rows used to be dropped silently on save; reject them instead.
    if (screeningQuestions.some((q) => !q.question.trim())) {
      setSubmitError('Fill in or remove the empty screening question')
      return
    }
    if (interviewQuestions.some((q) => !q.question.trim())) {
      setSubmitError('Fill in or remove the empty interview question')
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

    const origScreening = JSON.stringify(
      job.screening_questions?.length
        ? job.screening_questions
        : getDefaultScreeningQuestions(job.title),
    )
    const nextScreening = screeningQuestions
    if (origScreening !== JSON.stringify(nextScreening)) {
      payload.screening_questions = nextScreening
    }

    const origQuestions = JSON.stringify(job.interview_questions ?? [])
    const nextQuestions = interviewQuestions
    if (origQuestions !== JSON.stringify(nextQuestions)) {
      payload.interview_questions = nextQuestions
    }

    const origVoiceScreening = job.voice_screening_enabled !== false
    if (voiceScreeningEnabled !== origVoiceScreening) {
      payload.voice_screening_enabled = voiceScreeningEnabled
    }

    if (Object.keys(payload).length === 0) {
      toast('No changes to save')
      onClose()
      return
    }

    mutation.mutate(payload)
  }

  // Without this the page behind keeps its own scrollbar while the overlay is
  // up, so a second bar appears at the edge the moment the modal opens.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="flex h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
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
        <div className="scrollbar-thin-light flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {submitError && (
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
              <AlertCircle size={15} className="text-rose-500 mt-0.5 shrink-0" />
              <p className="text-sm text-rose-700">{submitError}</p>
            </div>
          )}

          {/* Job Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Job Title <RequiredMark />
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
              Description <RequiredMark />
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

          {/* Required Skills — Chip input (same pattern as CreateJobForm) */}
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
                max={EXPERIENCE_MAX_YEARS}
                step={1}
                value={minExp}
                onChange={(e) => {
                  const next = sanitizeYearsInput(e.target.value)
                  if (next !== null) setMinExp(next)
                }}
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
                max={EXPERIENCE_MAX_YEARS}
                step={1}
                value={maxExp}
                onChange={(e) => {
                  const next = sanitizeYearsInput(e.target.value)
                  if (next !== null) setMaxExp(next)
                }}
                placeholder="e.g. 6"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <VoiceScreeningSwitch
            checked={voiceScreeningEnabled}
            disabled={mutation.isPending}
            onChange={setVoiceScreeningEnabled}
            className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
          />

          <div>
            <ScreeningQuestionsEditor
              questions={screeningQuestions}
              onChange={setScreeningQuestions}
              disabled={mutation.isPending}
            />
            {missingScreeningQuestions && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                <AlertCircle size={11} />
                Add at least one screening question, or turn voice screening off
              </p>
            )}
          </div>

          <InterviewQuestionsEditor
            questions={interviewQuestions}
            onChange={setInterviewQuestions}
            disabled={mutation.isPending}
          />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending || missingScreeningQuestions}
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
