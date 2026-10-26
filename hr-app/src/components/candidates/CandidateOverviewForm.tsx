import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BTN_DANGER, BTN_STAGE_LINK } from '@/components/ui/Surface'
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

// Rejecting is an action (below), not a label: it also cancels calls and links.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'hired', label: 'Hired' },
]

// Stages where Reject does not apply: not yet scored, or done. ("Rejected" is not here: an
// old profile label can say Rejected for someone who is not on the Rejected list.)
const NOT_REJECTABLE_STAGES = new Set(['Processing', 'Failed', 'Hired', 'Finalist'])

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

/** Reject from the profile: the same Rejected stage as everywhere else. */
function RejectSection({ profile }: { profile: CandidateProfile }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => api.post(`/api/jobs/${profile.job_id}/candidates/${profile.id}/reject`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['candidates'] })
      void queryClient.invalidateQueries({ queryKey: ['candidate', profile.id] })
      for (const key of ['shortlist', 'screening', 'interviews-pipeline', 'rejected']) {
        void queryClient.invalidateQueries({ queryKey: [key, profile.job_id] })
      }
      toast.success(`${profile.name} moved to Rejected`)
      setConfirming(false)
    },
    onError: (err: Error) => setError(err.message || 'Could not reject this candidate.'),
  })

  // On the Rejected list only if the shortlist says so; an old "rejected" label alone is not
  // (it can still be rejected properly from here).
  if (profile.shortlist?.hr_decision === 'rejected') {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <span className="text-sm text-ink-muted">This candidate is rejected.</span>
        <Link to={`/jobs/${profile.job_id}/rejected`} className={BTN_STAGE_LINK}>
          Open Rejected
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    )
  }
  if (NOT_REJECTABLE_STAGES.has(profile.hiring_stage)) return null

  return (
    <div className="mt-6 border-t border-line pt-4">
      <button type="button" onClick={() => setConfirming(true)} className={BTN_DANGER}>
        <X size={13} aria-hidden />
        Reject candidate
      </button>
      {profile.hiring_stage === 'Rejected' && (
        <p className="mt-2 text-xs text-ink-muted">
          This profile carries an old "rejected" label but they are not on the Rejected list.
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Reject ${profile.name}?`}
          body={
            <p>
              They move to Rejected and anything not yet started (a call, an interview link) is
              cancelled. They are not emailed until you send it from the Rejected list, and you
              can reconsider until then.
            </p>
          }
          confirmLabel="Reject candidate"
          busy={mutation.isPending}
          error={error}
          onConfirm={() => {
            setError(null)
            mutation.mutate()
          }}
          onClose={() => {
            setConfirming(false)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

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
    mutation.mutate(candidateUpdatePayload(form, candidateFormFromProfile(profile)))
  }

  return (
    <>
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
    <RejectSection profile={profile} />
    </>
  )
}
