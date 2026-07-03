import { useState, useRef, type DragEvent, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Loader2,
  AlertCircle,
  Upload,
  Sparkles,
  Briefcase,
  Target,
  ClipboardList,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, ParsedJobDescription, InterviewQuestion, ScreeningQuestion } from '@/types/api'
import { InterviewQuestionsEditor } from '@/components/InterviewQuestionsEditor'
import { ScreeningQuestionsEditor } from '@/components/ScreeningQuestionsEditor'
import { getDefaultScreeningQuestions } from '@/lib/screeningDefaults'

interface CreateJobPayload {
  title: string
  description: string
  required_skills: string[]
  experience_min?: number
  experience_max?: number
  screening_questions?: ScreeningQuestion[]
  interview_questions?: InterviewQuestion[]
}

interface FieldErrors {
  title?: string
  description?: string
}

interface Props {
  onSuccess?: (job: Job) => void
  onCancel?: () => void
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/15'

function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/60">
          {icon}
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  )
}

function FieldLabel({
  htmlFor,
  required,
  children,
  hint,
}: {
  htmlFor?: string
  required?: boolean
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {children}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function CreateJobForm({ onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [minExp, setMinExp] = useState('')
  const [maxExp, setMaxExp] = useState('')
  const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>(() =>
    getDefaultScreeningQuestions(),
  )
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [wasPrefilled, setWasPrefilled] = useState(false)

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.post('/api/jobs/parse-jd', formData, {
        timeout: 90_000,
      }) as unknown as Promise<ParsedJobDescription>
    },
    onSuccess: (parsed) => {
      setUploadedFileName(null)
      setUploadError(null)
      setFieldErrors({})
      setSubmitError(null)
      setWasPrefilled(true)

      if (parsed.title) setTitle(parsed.title)
      if (parsed.description) setDescription(parsed.description)
      if (parsed.required_skills?.length) setSkills(parsed.required_skills)
      setMinExp(parsed.experience_min != null ? String(parsed.experience_min) : '')
      setMaxExp(parsed.experience_max != null ? String(parsed.experience_max) : '')
      if (parsed.screening_questions?.length) setScreeningQuestions(parsed.screening_questions)
      if (parsed.interview_questions?.length) setInterviewQuestions(parsed.interview_questions)

      toast.success('Fields extracted — review before creating')
    },
    onError: (err: Error) => {
      setUploadError(err.message ?? 'Failed to parse job description.')
      toast.error('Failed to parse job description')
    },
  })

  const mutation = useMutation({
    mutationFn: (payload: CreateJobPayload) =>
      api.post('/api/jobs', payload) as unknown as Promise<Job>,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job created successfully')
      onSuccess?.(job)
    },
    onError: (err: Error) => {
      toast.error('Failed to create job')
      setSubmitError(err.message ?? 'Failed to create job. Please try again.')
    },
  })

  const handleJdFile = (file: File | null) => {
    if (!file) return
    setUploadError(null)

    const valid =
      file.name.endsWith('.pdf') ||
      file.name.endsWith('.docx') ||
      file.name.endsWith('.doc') ||
      file.type === 'application/pdf' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (!valid) {
      setUploadError('Only PDF and DOCX files are allowed.')
      return
    }

    setUploadedFileName(file.name)
    parseMutation.mutate(file)
  }

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
    const errors: FieldErrors = {}
    if (!title.trim()) errors.title = 'Job title is required'
    if (!description.trim()) errors.description = 'Description is required'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setSubmitError(null)

    const finalSkills = [...skills]
    if (skillInput.trim()) {
      const trimmed = skillInput.trim()
      if (!finalSkills.includes(trimmed)) finalSkills.push(trimmed)
    }

    mutation.mutate({
      title: title.trim(),
      description: description.trim(),
      required_skills: finalSkills,
      experience_min: minExp ? Number(minExp) : undefined,
      experience_max: maxExp ? Number(maxExp) : undefined,
      screening_questions: screeningQuestions.filter((q) => q.question.trim()),
      interview_questions: interviewQuestions.filter((q) => q.question.trim()),
    })
  }

  const isParsing = parseMutation.isPending
  const isBusy = mutation.isPending || isParsing

  return (
    <>
      <div className="space-y-5">
        {/* Upload */}
        <FormSection
          icon={<Upload size={17} />}
          title="Import from document"
          description="Drop a PDF or DOCX job description to auto-fill the form below."
        >
          <label
            htmlFor="jd-upload"
            onDragOver={(e: DragEvent) => {
              e.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              setIsDragOver(false)
              handleJdFile(e.dataTransfer.files[0] ?? null)
            }}
            className={`relative block rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all duration-200 ${
              isParsing
                ? 'pointer-events-none border-indigo-200 bg-indigo-50/50'
                : isDragOver
                  ? 'cursor-copy border-indigo-300 bg-indigo-50/40'
                  : 'cursor-pointer border-slate-200 bg-slate-50/40 hover:border-indigo-200 hover:bg-indigo-50/30'
            }`}
          >
            {isParsing ? (
              <div className="flex flex-col items-center">
                <Loader2 size={24} className="mb-3 animate-spin text-indigo-600" />
                <p className="text-sm font-medium text-slate-700">
                  Reading {uploadedFileName ?? 'document'}…
                </p>
                <p className="mt-1 text-xs text-slate-400">Usually takes a few seconds</p>
              </div>
            ) : (
              <>
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm ring-1 ring-slate-200/80">
                  <Upload size={20} />
                </div>
                <p className="text-sm font-medium text-slate-700">
                  Drag & drop here, or{' '}
                  <span className="text-indigo-600 underline decoration-indigo-200 underline-offset-2">
                    browse files
                  </span>
                </p>
                <p className="mt-1.5 text-xs text-slate-400">PDF or DOCX · up to 20 MB</p>
              </>
            )}
            <input
              ref={fileInputRef}
              id="jd-upload"
              type="file"
              accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={isParsing}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                handleJdFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          {uploadError && (
            <p className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertCircle size={12} className="shrink-0" />
              {uploadError}
            </p>
          )}
        </FormSection>

        {wasPrefilled && !isParsing && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
            <Sparkles size={15} className="shrink-0 text-emerald-600" />
            <span>Pre-filled from your document — review each section before publishing.</span>
          </div>
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500" />
            <p className="text-sm text-rose-700">{submitError}</p>
          </div>
        )}

        {/* Job details */}
        <FormSection
          icon={<Briefcase size={17} />}
          title="Job details"
          description="Core information shown to candidates and used in matching."
        >
          <div>
            <FieldLabel htmlFor="job-title" required>
              Job title
            </FieldLabel>
            <input
              id="job-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (fieldErrors.title) setFieldErrors((p) => ({ ...p, title: undefined }))
              }}
              placeholder="e.g. Senior Frontend Engineer"
              className={`${inputClass} ${fieldErrors.title ? 'border-rose-300 ring-rose-500/15' : ''}`}
            />
            {fieldErrors.title && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                <AlertCircle size={11} />
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="job-description" required>
              Description
            </FieldLabel>
            <textarea
              id="job-description"
              rows={5}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                if (fieldErrors.description) setFieldErrors((p) => ({ ...p, description: undefined }))
              }}
              placeholder="Role overview, responsibilities, and what you're looking for…"
              className={`${inputClass} resize-y min-h-[120px] ${fieldErrors.description ? 'border-rose-300 ring-rose-500/15' : ''}`}
            />
            {fieldErrors.description && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                <AlertCircle size={11} />
                {fieldErrors.description}
              </p>
            )}
          </div>
        </FormSection>

        {/* Requirements */}
        <FormSection
          icon={<Target size={17} />}
          title="Requirements"
          description="Skills and experience used for screening and shortlisting."
        >
          <div>
            <FieldLabel hint="Press Enter or comma to add each skill.">
              Required skills
            </FieldLabel>
            <div className="min-h-[48px] rounded-lg border border-slate-200 bg-white p-2.5 transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/15">
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      aria-label={`Remove ${skill}`}
                      className="rounded p-0.5 leading-none text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
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
                placeholder={skills.length === 0 ? 'React, TypeScript, Node.js…' : 'Add another…'}
                aria-label="Add required skill"
                className="w-full bg-transparent text-sm placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="min-exp">Min experience</FieldLabel>
              <div className="relative">
                <input
                  id="min-exp"
                  type="number"
                  min={0}
                  value={minExp}
                  onChange={(e) => setMinExp(e.target.value)}
                  placeholder="3"
                  className={inputClass}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  yrs
                </span>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="max-exp">Max experience</FieldLabel>
              <div className="relative">
                <input
                  id="max-exp"
                  type="number"
                  min={0}
                  value={maxExp}
                  onChange={(e) => setMaxExp(e.target.value)}
                  placeholder="6"
                  className={inputClass}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  yrs
                </span>
              </div>
            </div>
          </div>
        </FormSection>

        {/* Evaluation */}
        <FormSection
          icon={<ClipboardList size={17} />}
          title="Evaluation"
          description="How candidates are screened and scored in interviews."
        >
          <ScreeningQuestionsEditor
            questions={screeningQuestions}
            onChange={setScreeningQuestions}
            disabled={isBusy}
            scrollable
          />

          <InterviewQuestionsEditor
            questions={interviewQuestions}
            onChange={setInterviewQuestions}
            disabled={isBusy}
            scrollable
          />
        </FormSection>
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
        <p className="hidden text-xs text-slate-400 sm:block">
          Required fields are marked with <span className="text-rose-500">*</span>
        </p>
        <div className="flex w-full justify-end gap-3 sm:w-auto">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Creating…
              </>
            ) : (
              'Create job'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
