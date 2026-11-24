import { type FormEvent, useState } from 'react'
import { KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, setStoredToken } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { TokenResponse } from '@/types/api'
import { Card, PageHeader } from '@/components/ui/Surface'
import { PasswordInput } from '@/components/PasswordInput'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { FormAlert } from '@/components/ui/FormAlert'
import { errorMessage } from '@/lib/errorMessage'
import { WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from '@/lib/validation'

/** Available to every signed-in role, unlike Settings which is admin-only. */
export default function AccountPage() {
  const { user, refreshUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Field problems sit under their field; a refusal from the server (a wrong current password,
  // say) sits above the button until the user changes something.
  const [nextError, setNextError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const clearErrors = () => {
    setFormError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldError =
      validatePassword(next, 'New password') ??
      (next === current ? 'Choose a password different from your current one' : null)
    const mismatch = !fieldError && next !== confirm ? 'The two new passwords do not match' : null
    setNextError(fieldError)
    setConfirmError(mismatch)
    setFormError(null)
    if (fieldError || mismatch) return

    setSubmitting(true)
    try {
      const result = (await api.post('/api/auth/change-password', {
        current_password: current,
        new_password: next,
      })) as unknown as TokenResponse
      // Other sessions were ended server-side; keep this one on a fresh token.
      setStoredToken(result.access_token)
      await refreshUser()
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Password updated')
    } catch (err) {
      setFormError(errorMessage(err, 'Could not update the password'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Account" subtitle={user ? `${user.full_name} · ${user.email}` : undefined} />

      <Card className="p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <KeyRound className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Change password</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Changing your password signs you out of every other device.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
          <div>
            <label htmlFor="current" className="mb-1.5 block text-xs font-medium text-ink-muted">
              Current password
              <RequiredMark />
            </label>
            <PasswordInput
              id="current"
              autoComplete="current-password"
              required
              maxLength={PASSWORD_MAX_LENGTH}
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value)
                clearErrors()
              }}
              className={WORKFLOW_INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="new" className="mb-1.5 block text-xs font-medium text-ink-muted">
              New password
              <RequiredMark />
            </label>
            <PasswordInput
              id="new"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={next}
              onChange={(e) => {
                setNext(e.target.value)
                setNextError(null)
                clearErrors()
              }}
              aria-invalid={nextError ? true : undefined}
              aria-describedby={nextError ? 'new-error' : 'new-hint'}
              className={WORKFLOW_INPUT_CLASS}
            />
            {nextError ? (
              <FieldError id="new-error" message={nextError} />
            ) : (
              <p id="new-hint" className="mt-1.5 text-xs text-ink-muted">{PASSWORD_HINT}</p>
            )}
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1.5 block text-xs font-medium text-ink-muted">
              Confirm new password
              <RequiredMark />
            </label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              required
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value)
                setConfirmError(null)
                clearErrors()
              }}
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? 'confirm-error' : undefined}
              className={WORKFLOW_INPUT_CLASS}
            />
            <FieldError id="confirm-error" message={confirmError} />
          </div>
          {formError && <FormAlert>{formError}</FormAlert>}
          <button
            type="submit"
            disabled={submitting}
            className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
          >
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </Card>
    </div>
  )
}
