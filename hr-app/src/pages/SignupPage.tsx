import { type ChangeEvent, type DragEvent, type FormEvent, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { FormAlert } from '@/components/ui/FormAlert'
import { errorMessage } from '@/lib/errorMessage'
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ORG_NAME_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  validateEmail,
  validateName,
  validateOrgName,
  validatePassword,
} from '@/lib/validation'

const MAX_GST_BYTES = 10 * 1024 * 1024

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type === 'application/x-pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  )
}

type SignupField = 'org' | 'name' | 'email' | 'password' | 'gst'
const SIGNUP_FIELDS: SignupField[] = ['org', 'name', 'email', 'password', 'gst']
const SIGNUP_FIELD_IDS: Record<SignupField, string> = {
  org: 'org',
  name: 'fullName',
  email: 'email',
  password: 'password',
  gst: 'gst',
}

export default function SignupPage() {
  const { signup, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const gstInputRef = useRef<HTMLInputElement>(null)

  const [organizationName, setOrganizationName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState('')
  const [gstDocument, setGstDocument] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Every problem shows under the field it belongs to, all at once, instead of one toast at a
  // time; a refusal from the server (an organization that already exists) sits above the button.
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const clearError = (field: SignupField) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
    setFormError(null)
  }
  const invalid = (field: SignupField) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${field}-error` : undefined,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  function applyGstFile(file: File | null) {
    if (!file) {
      setGstDocument(null)
      return
    }
    if (!isPdfFile(file)) {
      setErrors((prev) => ({ ...prev, gst: 'GST document must be a PDF' }))
      return
    }
    if (file.size > MAX_GST_BYTES) {
      setErrors((prev) => ({ ...prev, gst: 'GST document must be under 10 MB' }))
      return
    }
    clearError('gst')
    setGstDocument(file)
  }

  function onGstInputChange(e: ChangeEvent<HTMLInputElement>) {
    applyGstFile(e.target.files?.[0] ?? null)
    e.target.value = ''
  }

  function onGstDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    applyGstFile(e.dataTransfer.files?.[0] ?? null)
  }

  function clearGst() {
    setGstDocument(null)
    if (gstInputRef.current) gstInputRef.current.value = ''
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    // Mirrors the backend SignupRequest schema so invalid input never leaves the browser.
    // HTML5 type=email accepts hosts without a TLD (e.g. user@localhost / user@itcart).
    const next: Partial<Record<SignupField, string>> = {
      org: validateOrgName(organizationName) ?? undefined,
      name: validateName(fullName, 'Your name') ?? undefined,
      email: validateEmail(email, 'Work email') ?? undefined,
      password: validatePassword(password) ?? undefined,
      gst: !gstDocument
        ? 'GST document (PDF) is required'
        : !isPdfFile(gstDocument)
          ? 'GST document must be a PDF'
          : undefined,
    }
    setErrors(next)
    setFormError(null)
    const firstBad = SIGNUP_FIELDS.find((f) => next[f])
    if (firstBad || !gstDocument) {
      // Put the cursor on the first problem so a long form does not hide it below the fold.
      if (firstBad) document.getElementById(SIGNUP_FIELD_IDS[firstBad])?.focus()
      return
    }
    const emailNorm = email.trim()
    setSubmitting(true)
    try {
      const result = await signup({
        organization_name: organizationName.trim(),
        full_name: fullName.trim(),
        email: emailNorm,
        password,
        company_registration_number: companyRegistrationNumber.trim() || undefined,
        gst_document: gstDocument,
      })
      toast.success(result.message)
      navigate('/login', { replace: true })
    } catch (err) {
      setFormError(errorMessage(err, 'Signup failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Submit your GST documents for verification, then you're in."
      switchPrompt="Already have an account?"
      switchLabel="Sign in"
      switchTo="/login"
    >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="org" className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Organization name
              <RequiredMark />
            </label>
            <input
              id="org"
              required
              maxLength={ORG_NAME_MAX_LENGTH}
              value={organizationName}
              onChange={(e) => {
                setOrganizationName(e.target.value)
                clearError('org')
              }}
              {...invalid('org')}
              className={AUTH_INPUT_CLASS}
              placeholder="Acme Corp"
            />
            <FieldError id="org-error" message={errors.org} />
          </div>
          <div>
            <label htmlFor="fullName" className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Your name
              <RequiredMark />
            </label>
            <input
              id="fullName"
              required
              maxLength={PERSON_NAME_MAX_LENGTH}
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value)
                clearError('name')
              }}
              {...invalid('name')}
              className={AUTH_INPUT_CLASS}
              placeholder="Jane Doe"
            />
            <FieldError id="name-error" message={errors.name} />
          </div>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Work email
              <RequiredMark />
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearError('email')
              }}
              {...invalid('email')}
              className={AUTH_INPUT_CLASS}
              placeholder="you@company.com"
            />
            <FieldError id="email-error" message={errors.email} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Password
              <RequiredMark />
            </label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearError('password')
              }}
              {...invalid('password')}
              className={AUTH_INPUT_CLASS}
              placeholder="••••••••"
            />
            {errors.password ? (
              <FieldError id="password-error" message={errors.password} />
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">{PASSWORD_HINT}</p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="block text-sm font-medium text-slate-700">
                GST document
                <RequiredMark />
              </span>
              <span className="text-xs text-slate-400">PDF · max 10 MB</span>
            </div>

            <input
              ref={gstInputRef}
              id="gst"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={onGstInputChange}
            />

            {gstDocument ? (
              <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-indigo-100">
                  <FileText className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{gstDocument.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(gstDocument.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => gstInputRef.current?.click()}
                  className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearGst}
                  aria-label="Remove GST document"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                htmlFor="gst"
                onDragEnter={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                }}
                onDrop={onGstDrop}
                className={[
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors',
                  dragOver
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40',
                ].join(' ')}
              >
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                  <Upload className="h-4 w-4 text-slate-500" />
                </div>
                <p className="text-sm font-medium text-slate-700">
                  Drop your GST PDF here, or{' '}
                  <span className="text-indigo-600">browse</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">Required for organization verification</p>
              </label>
            )}
            <FieldError id="gst-error" message={errors.gst} />
          </div>

          <div>
            <label htmlFor="regNo" className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Company registration number{' '}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="regNo"
              value={companyRegistrationNumber}
              onChange={(e) => setCompanyRegistrationNumber(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="e.g. CIN / registration no."
            />
          </div>
          {formError && <FormAlert>{formError}</FormAlert>}
          <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </form>

    </AuthLayout>
  )
}
