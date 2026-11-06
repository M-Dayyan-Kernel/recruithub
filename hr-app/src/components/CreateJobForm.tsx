import { useState, useRef, useEffect, type DragEvent, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Loader2,
  AlertCircle,
  Upload,
  Sparkles,
  Briefcase,
  MapPin,
  Target,
  MessagesSquare,
  PhoneCall,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  Check,
  Pencil,
  ClipboardCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type {
  Job,
  ParsedJobDescription,
  InterviewTopic,
  ScreeningQuestion,
  SeniorityLevel,
  SystemSettings,
  WorkMode,
} from '@/types/api'
import { InterviewTopicsEditor } from '@/components/InterviewTopicsEditor'
import { cleanTopics, validateTopicPool, withIds } from '@/lib/interviewTopics'
import { ScreeningQuestionsEditor } from '@/components/ScreeningQuestionsEditor'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import { ExtensionCheckFields } from '@/components/job/ExtensionCheckFields'
import { useExtensionOrgEnabled } from '@/components/extensions/useExtensionOrgPolicy'
import type { ExtensionPolicyMode } from '@/types/integrity'
import { SeniorityField } from '@/components/SeniorityField'
import { WorkModeFields } from '@/components/WorkModeFields'
import { useStandardScreeningQuestions } from '@/hooks/useStandardScreeningQuestions'
import { remainingQuestionSlots } from '@/lib/screeningQuestions'
import { RequiredMark } from '@/components/FieldError'
import {
  SCREENING_QUESTIONS_MAX_TOTAL,
  SCREENING_QUESTION_MAX_LENGTH,
  WORK_LOCATION_MAX_LENGTH,
  validateScreeningQuestionText,
  validateWorkLocation,
} from '@/lib/validation'

interface CreateJobPayload {
  title: string
  description: string
  required_skills: string[]
  seniority_level: SeniorityLevel
  work_mode: WorkMode
  work_location?: string
  /** Only the role-specific and custom questions: the standard ones are the server's. */
  screening_questions?: ScreeningQuestion[]
  interview_topics?: InterviewTopic[]
  voice_screening_enabled?: boolean
  extension_check_enabled?: boolean
  extension_check_mode?: ExtensionPolicyMode
}

interface FieldErrors {
  title?: string
  description?: string
  screeningQuestions?: string
  interviewTopics?: string
  seniority?: string
  workMode?: string
}

interface Props {
  onSuccess?: (job: Job) => void
  onCancel?: () => void
  step: number
  onStepChange: (step: number) => void
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15'

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
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm [&_[role=radiogroup]]:flex-wrap">
      <div className="flex items-start gap-3 border-b border-slate-100 bg-white px-6 py-5">
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
      <div className="space-y-5 p-4 sm:p-6">{children}</div>
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
        {required && <RequiredMark />}
      </label>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

const steps = ['Job info', 'Requirements', 'Screening', 'Review']

export function CreateJobForm({ onSuccess, onCancel, step, onStepChange }: Props) {
  const queryClient = useQueryClient()
  const progressRef = useRef<HTMLElement>(null)
  const previousStep = useRef(step)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  // Suggested by the JD parser, confirmed by the recruiter. Null until one of those happens.
  const [seniority, setSeniority] = useState<SeniorityLevel | null>(null)
  // How the work is done. The JD fills these when it says; a choice made by hand is never
  // overwritten by a later parse.
  const [workMode, setWorkMode] = useState<WorkMode | null>(null)
  const [workLocation, setWorkLocation] = useState('')
  const workEditedByHand = useRef({ mode: false, location: false })
  // The role-specific and custom screening questions; the locked standard ones come from the API.
  const [extraQuestions, setExtraQuestions] = useState<ScreeningQuestion[]>([])
  // The pool the interviews draw from. The JD parser proposes it; HR reviews it here.
  const [interviewTopics, setInterviewTopics] = useState<InterviewTopic[]>([])
  const [voiceScreeningEnabled, setVoiceScreeningEnabled] = useState(true)
  const [extensionCheckEnabled, setExtensionCheckEnabled] = useState(true)
  const [extensionCheckMode, setExtensionCheckMode] = useState<ExtensionPolicyMode>('shadow')
  // While an Admin has the check off for the organization, the section is greyed out and the
  // starting values (on, shadow) are what is sent.
  const extensionOrgEnabled = useExtensionOrgEnabled()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [wasPrefilled, setWasPrefilled] = useState(false)

  const { data: standardData } = useStandardScreeningQuestions(title, workMode, workLocation)
  const standardQuestions = standardData?.standard ?? []
  const maxTotalQuestions = standardData?.max_total ?? SCREENING_QUESTIONS_MAX_TOTAL
  const maxQuestionChars = standardData?.max_chars ?? SCREENING_QUESTION_MAX_LENGTH
  const maxLocationChars = standardData?.max_location_chars ?? WORK_LOCATION_MAX_LENGTH

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  useEffect(() => {
    if (settings) {
      setVoiceScreeningEnabled(settings.screening_enabled)
    }
  }, [settings])

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
      setSeniority(parsed.seniority_level)
      if (parsed.work_mode && !workEditedByHand.current.mode) setWorkMode(parsed.work_mode)
      if (parsed.work_location && !workEditedByHand.current.location) {
        setWorkLocation(parsed.work_location)
      }
      // Only the role-specific questions are replaced: custom ones typed by hand stay, within the cap.
      if (parsed.screening_questions?.length) {
        setExtraQuestions((prev) => {
          const room = remainingQuestionSlots(standardQuestions.length, 0, maxTotalQuestions)
          return [...parsed.screening_questions!, ...prev.filter((q) => q.kind !== 'role')].slice(0, room)
        })
      }
      if (parsed.interview_topics?.length) setInterviewTopics(withIds(parsed.interview_topics))

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

  const validateStep = (current: number): boolean => {
    const errors: FieldErrors = {}
    if (current === 1) {
      if (!title.trim()) errors.title = 'Job title is required'
      if (!description.trim()) errors.description = 'Description is required'
      if (!workMode) errors.workMode = 'Choose how the work is done'
      else if (locationError) errors.workMode = locationError
    }
    if (current === 2 && !seniority) errors.seniority = 'Choose the seniority level'
    if (current === 3) {
      if (firstQuestionError) errors.screeningQuestions = firstQuestionError
      const topicError = validateTopicPool(interviewTopics)
      if (topicError) errors.interviewTopics = topicError
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const goToStep = (next: number) => {
    onStepChange(next)
    setSubmitError(null)
  }

  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    headingRef.current?.focus({ preventScroll: true })
    progressRef.current?.scrollIntoView({ block: 'start' })
  }, [step])

  const handleSubmit = () => {
    for (const current of [1, 2, 3]) {
      if (!validateStep(current)) {
        goToStep(current)
        return
      }
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
      seniority_level: seniority as SeniorityLevel,
      work_mode: workMode as WorkMode,
      work_location: workMode === 'remote' ? undefined : workLocation.trim(),
      screening_questions: extraQuestions.map((q) => ({ ...q, question: q.question.trim() })),
      interview_topics: cleanTopics(interviewTopics),
      voice_screening_enabled: voiceScreeningEnabled,
      extension_check_enabled: extensionCheckEnabled,
      extension_check_mode: extensionCheckMode,
    })
  }

  const isParsing = parseMutation.isPending
  const isBusy = mutation.isPending || isParsing
  // The first problem in the questions HR can edit, if any. The standard ones are never wrong.
  const firstQuestionError =
    extraQuestions
      .map((q) => validateScreeningQuestionText(q.question, maxQuestionChars))
      .find(Boolean) ?? null
  const locationError = validateWorkLocation(workMode, workLocation, maxLocationChars)

  return (
    <>
      <nav ref={progressRef} aria-label="Job creation progress" className="mb-10 mt-2 scroll-mt-6">
        <ol className="flex items-start">
          {steps.map((label, index) => {
            const number = index + 1
            const active = step === number
            const complete = step > number
            return (
              <li key={label} className="relative flex flex-1 flex-col items-center">
                {index < steps.length - 1 && (
                  <span aria-hidden="true" className={`absolute left-1/2 top-4 h-px w-full ${complete ? 'bg-accent' : 'bg-slate-200'}`} />
                )}
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Step ${number}: ${label}`}
                  disabled={!complete || isBusy}
                  onClick={() => goToStep(number)}
                  className="relative z-10 flex flex-col items-center gap-2.5 disabled:cursor-default focus-visible:outline-accent"
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${active ? 'bg-accent text-accent-ink shadow-sm ring-4 ring-accent-soft' : complete ? 'bg-accent-soft text-accent' : 'border-2 border-slate-200 bg-white text-slate-400'}`}>
                    {complete ? <Check size={15} /> : number}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider sm:text-xs ${active ? 'text-accent' : complete ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="mb-6">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-accent">Step {step} of 4</p>
        <h1 ref={headingRef} tabIndex={-1} className="scroll-mt-6 text-2xl font-semibold tracking-tight text-slate-900 outline-none">
          {['Tell us about the role', 'Define your ideal candidate', 'Set up the screening process', 'Review your job'][step - 1]}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {['Import a job description or enter the details below.', 'Choose the skills and experience this role needs.', 'Configure phone screening, interview topics, and candidate checks.', 'Check each section before creating your job.'][step - 1]}
        </p>
      </div>
      {submitError && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{submitError}</p>}
      <div className="space-y-5">
        {step === 1 && (<>
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
                    ? 'pointer-events-none border-accent-border bg-accent-soft/50'
                    : isDragOver
                      ? 'cursor-copy border-accent bg-accent-soft/40'
                      : 'cursor-pointer border-slate-200 bg-slate-50/40 hover:border-accent-border hover:bg-accent-soft/30'
                }`}
              >
                {isParsing ? (
                  <div className="flex flex-col items-center">
                    <Loader2 size={24} className="mb-3 animate-spin text-accent" />
                    <p className="text-sm font-medium text-slate-700">
                      Reading {uploadedFileName ?? 'document'}…
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Usually takes a few seconds</p>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-accent shadow-sm ring-1 ring-slate-200/80">
                      <Upload size={20} />
                    </div>
                    <p className="text-sm font-medium text-slate-700">
                      Drag & drop here, or{' '}
                      <span className="text-accent underline decoration-accent-border underline-offset-2">
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

            {/* Work arrangement */}
            <FormSection
              icon={<MapPin size={17} />}
              title="Work arrangement"
              description="Remote, hybrid or on-site. The screening call asks candidates about the location based on this."
            >
              <WorkModeFields
                mode={workMode}
                location={workLocation}
                onModeChange={(next) => {
                  workEditedByHand.current.mode = true
                  setWorkMode(next)
                  setFieldErrors((previous) => ({ ...previous, workMode: undefined }))
                }}
                onLocationChange={(next) => {
                  workEditedByHand.current.location = true
                  setWorkLocation(next)
                  setFieldErrors((previous) => ({ ...previous, workMode: undefined }))
                }}
                disabled={isBusy}
                modeError={!workMode ? fieldErrors.workMode : null}
                locationError={workMode ? fieldErrors.workMode ?? (workLocation ? locationError : null) : null}
                maxLocationChars={maxLocationChars}
                hint={
                  workMode
                    ? undefined
                    : wasPrefilled
                      ? 'The job description does not say how the work is done. Choose one to continue.'
                      : 'Choose one to continue. A job description that states it fills this in for you.'
                }
              />
            </FormSection>

        </>)}
        {step === 2 && (<>
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
                <div className="min-h-[48px] rounded-lg border border-slate-200 bg-white p-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {skills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-accent-border"
                      >
                        {skill}
                        <button
                          type="button"
                          onClick={() => removeSkill(skill)}
                          aria-label={`Remove ${skill}`}
                          className="rounded p-0.5 leading-none text-accent transition-colors hover:bg-accent-soft hover:text-accent"
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

              <SeniorityField
                value={seniority}
                onChange={(level) => {
                  setSeniority(level)
                  setFieldErrors((p) => ({ ...p, seniority: undefined }))
                }}
                error={fieldErrors.seniority}
                hint={wasPrefilled ? 'Suggested from the job description. Change it if it is wrong.' : undefined}
              />
            </FormSection>

        </>)}
        {step === 3 && (<>
            {/* Phone screening: the AI call that comes before the interview */}
            <FormSection
              icon={<PhoneCall size={17} />}
              title="Phone screening"
              description="The short AI call that checks the basics before a candidate is invited to interview."
            >
              <VoiceScreeningSwitch
                checked={voiceScreeningEnabled}
                disabled={isBusy}
                onChange={setVoiceScreeningEnabled}
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
              />

              <div>
                <ScreeningQuestionsEditor
                  standard={standardQuestions}
                  questions={extraQuestions}
                  onChange={(next) => {
                    setExtraQuestions(next)
                    if (fieldErrors.screeningQuestions) {
                      setFieldErrors((p) => ({ ...p, screeningQuestions: undefined }))
                    }
                  }}
                  maxTotal={maxTotalQuestions}
                  maxChars={maxQuestionChars}
                  disabled={isBusy}
                  scrollable
                />
                {fieldErrors.screeningQuestions && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600" role="alert">
                    <AlertCircle size={11} />
                    {fieldErrors.screeningQuestions}
                  </p>
                )}
              </div>
            </FormSection>

            {/* The AI interview itself */}
            <FormSection
              icon={<MessagesSquare size={17} />}
              title="AI interview"
              description="What the AI interviewer covers. Each candidate gets their own questions, drawn from these topics."
            >
              <div>
                <InterviewTopicsEditor
                  topics={interviewTopics}
                  onChange={(next) => {
                    setInterviewTopics(next)
                    if (fieldErrors.interviewTopics) {
                      setFieldErrors((p) => ({ ...p, interviewTopics: undefined }))
                    }
                  }}
                  job={{ title, description, required_skills: skills, seniority_level: seniority }}
                  disabled={isBusy}
                  error={fieldErrors.interviewTopics}
                  scrollable
                />
              </div>
            </FormSection>

            {/* AI extension check */}
            <FormSection
              icon={<ShieldCheck size={17} />}
              title="AI extension check"
              description="Blocks candidates who run AI-assistant browser extensions during the interview."
            >
              <ExtensionCheckFields
                enabled={extensionCheckEnabled}
                mode={extensionCheckMode}
                onEnabledChange={setExtensionCheckEnabled}
                onModeChange={setExtensionCheckMode}
                disabled={isBusy}
                locked={!extensionOrgEnabled}
              />
            </FormSection>
        </>)}
        {step === 4 && (<>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <ClipboardCheck size={19} className="shrink-0" />
            Your job is ready for a final check. You can edit any section below.
          </div>
          {[
            { title: 'Job info', target: 1, content: <>
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{description}</p>
              <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Work arrangement: </span>{workMode === 'remote' ? 'Remote' : `${workMode === 'hybrid' ? 'Hybrid' : 'On-site'} · ${workLocation}`}</p>
            </> },
            { title: 'Requirements', target: 2, content: <>
              <p className="text-sm capitalize text-slate-600"><span className="font-medium text-slate-800">Seniority: </span>{seniority}</p>
              <div className="flex flex-wrap gap-2">{skills.length ? skills.map((skill) => <span key={skill} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">{skill}</span>) : <p className="text-sm text-slate-500">No specific skills added.</p>}</div>
            </> },
            { title: 'Screening & interview', target: 3, content: <>
              <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Phone screening: </span>{voiceScreeningEnabled ? 'Enabled' : 'Disabled'}</p>
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Screening questions ({standardQuestions.length + extraQuestions.length})</p>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">{[...standardQuestions, ...extraQuestions].map((question, index) => <li key={index}>{question.question}</li>)}</ol>
                {!standardQuestions.length && !extraQuestions.length && <p className="text-sm text-slate-500">No screening questions loaded.</p>}
              </div>
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Interview topics ({interviewTopics.length})</p>
                <div className="space-y-3">{interviewTopics.map((topic) => <div key={topic.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium text-slate-800">{topic.name}{topic.is_mandatory ? ' · Mandatory' : ''}</p><p className="mt-1 text-slate-600">{topic.scope}</p><p className="mt-1 text-xs text-slate-500">Skill: {topic.skill_tag}</p><p className="mt-2 text-slate-600">{topic.seed_question}</p></div>)}</div>
                {!interviewTopics.length && <p className="text-sm text-slate-500">No interview topics added.</p>}
              </div>
              <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">AI extension check: </span>{!extensionOrgEnabled ? 'Disabled by your organization' : extensionCheckEnabled ? `Enabled · ${extensionCheckMode}` : 'Disabled'}</p>
            </> },
          ].map((section) => (
            <section key={section.title} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h2 className="text-sm font-semibold text-slate-900">{section.title}</h2>
                <button type="button" disabled={isBusy} onClick={() => goToStep(section.target)} aria-label={`Edit ${section.title}`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-50"><Pencil size={12} />Edit</button>
              </div>
              <div className="space-y-4 p-6">{section.content}</div>
            </section>
          ))}
        </>)}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
        <p className="hidden text-xs text-slate-400 sm:block">
          Step {step} of 4 · {steps[step - 1]}
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
          {step > 1 && (
            <button type="button" disabled={isBusy} onClick={() => goToStep(step - 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"><ArrowLeft size={15} />Back</button>
          )}
          <button
            type="button"
            onClick={() => {
              if (step === 4) handleSubmit()
              else if (validateStep(step)) goToStep(step + 1)
            }}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink shadow-accent transition-all hover:bg-accent-hover hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Creating…
              </>
            ) : (
              <>{step === 4 ? 'Create job' : 'Continue'}{step < 4 && <ArrowRight size={15} />}</>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
