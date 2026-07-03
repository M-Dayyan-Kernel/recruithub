import { useState, useRef, type DragEvent, type ChangeEvent, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, AlertCircle, Upload, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, ParsedJobDescription } from '@/types/api'

interface CreateJobPayload {
  title: string
  description: string
  required_skills: string[]
  experience_min?: number
  experience_max?: number
  screening_criteria?: string
  interview_evaluation_criteria?: string
}

interface FieldErrors {
  title?: string
  description?: string
}

interface Props {
  onSuccess?: (job: Job) => void
  onCancel?: () => void
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
  const [screeningCriteria, setScreeningCriteria] = useState('')
  const [interviewCriteria, setInterviewCriteria] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)

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

      if (parsed.title) setTitle(parsed.title)
      if (parsed.description) setDescription(parsed.description)
      if (parsed.required_skills?.length) setSkills(parsed.required_skills)
      setMinExp(parsed.experience_min != null ? String(parsed.experience_min) : '')
      setMaxExp(parsed.experience_max != null ? String(parsed.experience_max) : '')
      if (parsed.screening_criteria) setScreeningCriteria(parsed.screening_criteria)
      if (parsed.interview_evaluation_criteria) setInterviewCriteria(parsed.interview_evaluation_criteria)

      toast.success('Job description extracted — review the fields below')
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
      screening_criteria: screeningCriteria.trim() || undefined,
      interview_evaluation_criteria: interviewCriteria.trim() || undefined,
    })
  }

  const isParsing = parseMutation.isPending

  return (
    <>
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Upload Job Description
          </label>
          <div
            onClick={() => !isParsing && fileInputRef.current?.click()}
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
            className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              isParsing
                ? 'pointer-events-none border-indigo-300 bg-indigo-50'
                : isDragOver
                  ? 'cursor-copy border-indigo-400 bg-indigo-50'
                  : 'cursor-pointer border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40'
            }`}
          >
            {isParsing ? (
              <div className="flex flex-col items-center justify-center">
                <Loader2 size={22} className="mb-2 animate-spin text-indigo-600" />
                <p className="text-sm font-medium text-indigo-700">
                  Extracting fields from {uploadedFileName ?? 'document'}…
                </p>
                <p className="mt-1 text-xs text-indigo-500">This may take a few seconds</p>
              </div>
            ) : (
              <>
                <Upload size={22} className="mx-auto mb-2 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">
                  Drag &amp; drop a JD here, or{' '}
                  <span className="text-indigo-600">browse</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">PDF or DOCX — fields will auto-fill below</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                handleJdFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </div>
          {uploadError && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
              <AlertCircle size={11} />
              {uploadError}
            </p>
          )}
        </div>

        {(title || description || skills.length > 0) && !isParsing && (
          <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            <FileText size={14} className="shrink-0" />
            Fields pre-filled from document — review and edit before creating
          </div>
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500" />
            <p className="text-sm text-rose-700">{submitError}</p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Job Title <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (fieldErrors.title) setFieldErrors((p) => ({ ...p, title: undefined }))
            }}
            placeholder="e.g. Senior Frontend Engineer"
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              fieldErrors.title ? 'border-rose-400' : 'border-slate-200'
            }`}
          />
          {fieldErrors.title && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
               <AlertCircle size={11} />
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Description <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              if (fieldErrors.description) setFieldErrors((p) => ({ ...p, description: undefined }))
            }}
            placeholder="Describe the role, responsibilities, and what you're looking for..."
            className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              fieldErrors.description ? 'border-rose-400' : 'border-slate-200'
            }`}
          />
          {fieldErrors.description && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
              <AlertCircle size={11} />
              {fieldErrors.description}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Required Skills</label>
          <div className="min-h-[44px] rounded-lg border border-slate-200 p-2 focus-within:border-transparent focus-within:ring-2 focus-within:ring-indigo-500">
            <div className="mb-1 flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(skill)}
                    className="ml-0.5 leading-none hover:text-indigo-900"
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
              className="w-full text-sm placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">Press Enter or comma to add a skill chip</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Min Experience (years)
            </label>
            <input
              type="number"
              min={0}
              value={minExp}
              onChange={(e) => setMinExp(e.target.value)}
              placeholder="e.g. 3"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Max Experience (years)
            </label>
            <input
              type="number"
              min={0}
              value={maxExp}
              onChange={(e) => setMaxExp(e.target.value)}
              placeholder="e.g. 6"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Screening Criteria
          </label>
          <textarea
            rows={3}
            value={screeningCriteria}
            onChange={(e) => setScreeningCriteria(e.target.value)}
            placeholder="e.g. Must have 3+ years Python, Must be available in 2 weeks..."
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Interview Evaluation Criteria
          </label>
          <textarea
            rows={3}
            value={interviewCriteria}
            onChange={(e) => setInterviewCriteria(e.target.value)}
            placeholder="e.g. Assess problem-solving, system design, communication..."
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={mutation.isPending || isParsing}
            className="px-4 py-2 text-sm text-slate-600 transition-colors hover:text-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={mutation.isPending || isParsing}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Creating...
            </>
          ) : (
            'Create Job'
          )}
        </button>
      </div>
    </>
  )
}
