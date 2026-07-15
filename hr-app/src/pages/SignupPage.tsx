import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'

export default function SignupPage() {
  const { signup, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()

  const [organizationName, setOrganizationName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState('')
  const [gstDocument, setGstDocument] = useState<File | null>(null)
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!gstDocument) {
      toast.error('GST document (PDF) is required')
      return
    }
    if (!gstDocument.name.toLowerCase().endsWith('.pdf')) {
      toast.error('GST document must be a PDF')
      return
    }
    setSubmitting(true)
    try {
      const result = await signup({
        organization_name: organizationName.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-zinc-50 to-slate-200 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Create organization</h1>
            <p className="text-sm text-slate-500">
              Submit GST documents for verification before access
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="org" className="mb-1.5 block text-sm font-medium text-slate-700">
              Organization name
            </label>
            <input
              id="org"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
              Your name
            </label>
            <input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label htmlFor="gst" className="mb-1.5 block text-sm font-medium text-slate-700">
              GST document <span className="text-red-500">*</span>
            </label>
            <input
              id="gst"
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(e) => setGstDocument(e.target.files?.[0] ?? null)}
              className={`${WORKFLOW_INPUT_CLASS} cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-700`}
            />
            <p className="mt-1 text-xs text-slate-500">PDF only, max 10 MB. Required for verification.</p>
          </div>
          <div>
            <label htmlFor="regNo" className="mb-1.5 block text-sm font-medium text-slate-700">
              Company registration number{' '}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="regNo"
              value={companyRegistrationNumber}
              onChange={(e) => setCompanyRegistrationNumber(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
              placeholder="e.g. CIN / registration no."
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full justify-center disabled:opacity-60`}
          >
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
