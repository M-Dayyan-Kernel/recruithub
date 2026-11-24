import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import AuthLayout, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '@/components/auth/AuthLayout'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { FormAlert, WRAP_SAFE } from '@/components/ui/FormAlert'
import { errorMessage } from '@/lib/errorMessage'
import { validateEmail } from '@/lib/validation'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const error = validateEmail(email, 'Email')
    setEmailError(error)
    setFormError(null)
    if (error) return
    setSubmitting(true)
    try {
      await api.post('/api/auth/forgot-password', { email: email.trim() })
      // The API answers the same way for every address, so this screen must too.
      setSent(true)
    } catch (err) {
      setFormError(errorMessage(err, 'Could not send the reset link'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your work email and we'll send you a link to choose a new one."
      switchPrompt="Remembered it?"
      switchLabel="Sign in"
      switchTo="/login"
    >
      {sent ? (
        <div className="space-y-4" role="status">
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className={`text-sm text-emerald-900 ${WRAP_SAFE}`}>
              If an account exists for <strong>{email.trim()}</strong>, a reset link is on its
              way. It can be used once and expires in 60 minutes.
            </p>
          </div>
          <Link to="/login" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
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
                setEmailError(null)
                setFormError(null)
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'email-error' : undefined}
              className={AUTH_INPUT_CLASS}
              placeholder="you@company.com"
            />
            <FieldError id="email-error" message={emailError} />
          </div>
          {formError && <FormAlert>{formError}</FormAlert>}
          <button type="submit" disabled={submitting} className={`${AUTH_BUTTON_CLASS} !mt-6`}>
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
