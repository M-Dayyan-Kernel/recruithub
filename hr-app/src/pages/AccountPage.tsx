import { type FormEvent, useState } from 'react'
import { KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, setStoredToken } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { TokenResponse } from '@/types/api'
import { Card, PageHeader } from '@/components/ui/Surface'
import { PasswordInput } from '@/components/PasswordInput'
import { RequiredMark } from '@/components/FieldError'
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldError = validatePassword(next, 'New password')
    if (fieldError) {
      toast.error(fieldError)
      return
    }
    if (next !== confirm) {
      toast.error('The two new passwords do not match')
      return
    }
    if (next === current) {
      toast.error('Choose a password different from your current one')
      return
    }

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
      toast.error(err instanceof Error ? err.message : 'Could not update the password')
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
              onChange={(e) => setCurrent(e.target.value)}
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
              onChange={(e) => setNext(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
            />
            <p className="mt-1.5 text-xs text-ink-muted">{PASSWORD_HINT}</p>
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
              onChange={(e) => setConfirm(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
            />
          </div>
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
