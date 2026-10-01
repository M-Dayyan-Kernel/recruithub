import { type FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { takeSignedOutReason } from '@/lib/api'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { RequiredMark } from '@/components/FieldError'

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Read once on mount and clear, so the notice survives the redirect's full
  // page load but does not reappear on the next visit.
  const [signedOutReason, setSignedOutReason] = useState(takeSignedOutReason)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSignedOutReason(null)
    try {
      const signedIn = await login({ email: email.trim(), password })
      toast.success('Signed in')
      const dest =
        signedIn.role === 'superadmin' && (from === '/' || from === '/login')
          ? '/admin'
          : from
      navigate(dest, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to Recruitment Hub."
      switchPrompt="New organization?"
      switchLabel="Create an account"
      switchTo="/signup"
    >
      {signedOutReason && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900">You have been signed out</p>
            <p className="mt-0.5 text-sm text-amber-800">{signedOutReason}</p>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-[13px] font-semibold text-slate-700"
          >
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
          <label
            htmlFor="password"
            className="mb-1.5 block text-[13px] font-semibold text-slate-700"
          >
            Password
            <RequiredMark />
          </label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
