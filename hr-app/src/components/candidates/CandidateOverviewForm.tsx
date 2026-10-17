import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CandidateProfile } from '@/types/api'
import { useUpdateCandidate } from '@/hooks/useUpdateCandidate'
import { formatHiringStage } from '@/lib/candidates'
import {
  candidateFormFromProfile,
  candidateUpdatePayload,
  firstInvalidField,
  isRequiredCandidateField,
  validateCandidateField,
  validateCandidateForm,
  type CandidateFormErrors,
  type CandidateFormField,
  type CandidateFormValues,
} from '@/lib/candidateForm'
import { isPlaceholderEmail } from '@/lib/validation'
import { WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hired', label: 'Hired' },
]

interface Props {
  profile: CandidateProfile
}

interface FieldConfig {
  key: Exclude<CandidateFormField, 'status'>
  label: string
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
  autoComplete?: string
  hint?: string
}

const FIELDS: FieldConfig[] = [
  { key: 'name', label: 'Name', autoComplete: 'off' },
  { key: 'email', label: 'Email', type: 'email', inputMode: 'email', autoComplete: 'off' },
  { key: 'phone', label: 'Phone', type: 'tel', inputMode: 'tel', autoComplete: 'off' },
  // Text + decimal keypad rather than type="number": a number input can hold
  // text the form state never sees, which is how bad values slip past validation.
  { key: 'years_experience', label: 'Years of experience', inputMode: 'decimal' },
  { key: 'current_ctc', label: 'Current CTC' },
  { key: 'expected_ctc', label: 'Expected CTC' },
  { key: 'notice_period', label: 'Notice period' },
  { key: 'last_working_day', label: 'Last working day', type: 'date' },
]

const inputId = (key: string) => `candidate-${key}`

export function CandidateOverviewForm({ profile }: Props) {
  const mutation = useUpdateCandidate(profile.id)
  const [form, setForm] = useState<CandidateFormValues>(() => candidateFormFromProfile(profile))
  const [errors, setErrors] = useState<CandidateFormErrors>({})
  const formRef = useRef<HTMLFormElement>(null)

  // A refreshed profile (after a save, or navigating between candidates)
  // replaces the form, so stale messages must go with the old values.
  useEffect(() => {
    setForm(candidateFormFromProfile(profile))
    setErrors({})
  }, [profile])

  const emailIsMissing = isPlaceholderEmail(profile.email)

  const setField = (key: CandidateFormField, value: string) => {
    const next = { ...form, [key]: value }
    setForm(next)
    // Once a field has been flagged, re-check it as it is edited so the message
    // clears the moment it is fixed (and not before the user has finished).
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: validateCandidateField(key, next) }))
    }
  }

  const checkField = (key: CandidateFormField) => {
    setErrors((prev) => ({ ...prev, [key]: validateCandidateField(key, form) }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const found = validateCandidateForm(form)
    setErrors(found)
    const first = firstInvalidField(found)
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#${inputId(first)}`)?.focus()
      return
    }
    mutation.mutate(candidateUpdatePayload(form))
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5">
      <p className="text-xs text-slate-500">
        <span aria-hidden="true" className="text-rose-500">
          *
        </span>{' '}
        Required
      </p>

      {emailIsMissing && !form.email && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No email address was found on this candidate&rsquo;s resume. Add one so interview
          links and updates can reach them.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, label, type = 'text', inputMode, autoComplete }) => {
          const required = isRequiredCandidateField(key)
          const error = errors[key]
          return (
            <div key={key}>
              <label
                htmlFor={inputId(key)}
                className="mb-1.5 block text-xs font-medium text-slate-500"
              >
                {label}
                {required && <RequiredMark />}
              </label>
              <input
                id={inputId(key)}
                type={type}
                inputMode={inputMode}
                autoComplete={autoComplete}
                value={form[key]}
                required={required}
                aria-required={required || undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId(key)}-error` : undefined}
                onChange={(e) => setField(key, e.target.value)}
                onBlur={() => checkField(key)}
                className={cn(WORKFLOW_INPUT_CLASS, error && 'border-rose-300 ring-rose-500/15')}
              />
              {error && (
                <div id={`${inputId(key)}-error`}>
                  <FieldError message={error} />
                </div>
              )}
            </div>
          )
        })}
        <div>
          <label
            htmlFor={inputId('status')}
            className="mb-1.5 block text-xs font-medium text-slate-500"
          >
            Status
          </label>
          <select
            id={inputId('status')}
            value={form.status}
            onChange={(e) => setField('status', e.target.value)}
            className={WORKFLOW_INPUT_CLASS}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Applied job</label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {profile.job_title}
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Hiring stage</label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {formatHiringStage(profile.hiring_stage)}
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700',
          mutation.isPending && 'opacity-70',
        )}
      >
        {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
        Save changes
      </button>
    </form>
  )
}
