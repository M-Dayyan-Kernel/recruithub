import { type ChangeEvent, type DragEvent, type FormEvent, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { RequiredMark } from '@/components/FieldError'
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
      toast.error('GST document must be a PDF')
      return
    }
    if (file.size > MAX_GST_BYTES) {
      toast.error('GST document must be under 10 MB')
      return
    }
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
    const fieldError =
      validateOrgName(organizationName) ??
      validateName(fullName, 'Your name') ??
      validateEmail(email, 'Work email') ??
      validatePassword(password)
    if (fieldError) {
      toast.error(fieldError)
      return
    }
    if (!gstDocument) {
      toast.error('GST document (PDF) is required')
      return
    }
    if (!isPdfFile(gstDocument)) {
      toast.error('GST document must be a PDF')
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
      toast.error(err instanceof Error ? err.message : 'Signup failed')
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
        <form onSubmit={onSubmit} className="space-y-4">
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
              onChange={(e) => setOrganizationName(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="Acme Corp"
            />
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
              onChange={(e) => setFullName(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="Jane Doe"
            />
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
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="you@company.com"
            />
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
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="••••••••"
            />
            <p className="mt-1.5 text-xs text-slate-500">{PASSWORD_HINT}</p>
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
          <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </form>

    </AuthLayout>
  )
}
