import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { takeSignedOutReason } from '@/lib/api'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { RequiredMark } from '@/components/FieldError'
import { FormAlert } from '@/components/ui/FormAlert'
import { errorMessage } from '@/lib/errorMessage'

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Kept on the form until the user changes something: a toast was gone before most people
  // had read it, and sat half off-screen in a narrow window.
  const [formError, setFormError] = useState<string | null>(null)
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
    setFormError(null)
    try {
      const signedIn = await login({ email: email.trim(), password })
      toast.success('Signed in')
      const dest =
        signedIn.role === 'superadmin' && (from === '/' || from === '/login')
          ? '/admin'
          : from
      navigate(dest, { replace: true })
    } catch (err) {
      setFormError(errorMessage(err, 'Sign in failed. Try again.'))
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
        <FormAlert tone="warn" title="You have been signed out" className="mb-6">
          {signedOutReason}
        </FormAlert>
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
            onChange={(e) => {
              setEmail(e.target.value)
              setFormError(null)
            }}
            className={AUTH_INPUT_CLASS}
            placeholder="you@company.com"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700">
              Password
              <RequiredMark />
            </label>
            <Link
              to="/forgot-password"
              className="text-[13px] font-medium text-indigo-600 hover:text-indigo-500"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setFormError(null)
            }}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'login-error' : undefined}
            className={AUTH_INPUT_CLASS}
            placeholder="••••••••"
          />
        </div>

        {formError && (
          <div id="login-error">
            <FormAlert>{formError}</FormAlert>
          </div>
        )}

        <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
