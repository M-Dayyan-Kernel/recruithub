import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { PasswordTokenInfo } from '@/types/api'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/PasswordInput'
import { RequiredMark } from '@/components/FieldError'
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from '@/lib/validation'

/**
 * Redeems an emailed link: either the first-password link sent when a Super
 * Admin onboards an organization, or a forgotten-password reset. Both are the
 * same one-time token on the backend.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() || ''
  const navigate = useNavigate()
  const { logout } = useAuth()

  const [info, setInfo] = useState<PasswordTokenInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token. Request a new one.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = (await api.get(
          `/api/auth/password-token/${encodeURIComponent(token)}`,
        )) as unknown as PasswordTokenInfo
        if (!cancelled) setInfo(data)
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'This link is invalid or has expired. Request a new one.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldError = validatePassword(password, 'Password')
    if (fieldError) {
      toast.error(fieldError)
      return
    }
    if (password !== confirm) {
      toast.error('The two passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/api/auth/reset-password', { token, password })
      // End any session already open in this browser: it may belong to someone else.
      logout()
      toast.success('Password updated. Please sign in.')
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the password')
    } finally {
      setSubmitting(false)
    }
  }

  const isOnboarding = info?.purpose === 'onboarding'

  return (
    <AuthLayout
      title={isOnboarding ? 'Set your password' : 'Choose a new password'}
      subtitle={
        isOnboarding
          ? 'Welcome to Recruitment Hub. Choose a password to finish setting up your account.'
          : 'Pick a strong password you have not used before.'
      }
      switchPrompt="Back to"
      switchLabel="Sign in"
      switchTo="/login"
    >
      {loadError ? (
        <div className="space-y-4" role="alert">
          <p className="text-sm text-red-600">{loadError}</p>
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Request a new link
          </Link>
        </div>
      ) : !info ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Email</label>
            <input
              type="email"
              value={info.email}
              disabled
              className={`${AUTH_INPUT_CLASS} bg-slate-50 text-slate-500`}
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-[13px] font-semibold text-slate-700"
            >
              New password
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
            <label
              htmlFor="confirm"
              className="mb-1.5 block text-[13px] font-semibold text-slate-700"
            >
              Confirm password
              <RequiredMark />
            </label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              required
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={AUTH_INPUT_CLASS}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Saving…' : isOnboarding ? 'Set password' : 'Update password'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
