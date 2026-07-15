import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { InvitePublic } from '@/types/api'
import { WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'

export default function AcceptInvitePage() {
  const { acceptInvite, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() || ''

  const [invite, setInvite] = useState<InvitePublic | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('Missing invite token')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = (await api.get(`/api/auth/invites/${encodeURIComponent(token)}`)) as unknown as InvitePublic
        if (!cancelled) setInvite(data)
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Invite not found or expired')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

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
    if (!token) return
    setSubmitting(true)
    try {
      await acceptInvite({ token, full_name: fullName.trim(), password })
      toast.success('Welcome aboard')
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept invite')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-zinc-50 to-slate-200 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Accept invite</h1>
            <p className="text-sm text-slate-500">
              {invite
                ? `Join ${invite.organization_name} as ${invite.role}`
                : 'Complete your account'}
            </p>
          </div>
        </div>

        {loadError ? (
          <div className="space-y-4">
            <p className="text-sm text-red-600">{loadError}</p>
            <Link to="/login" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Back to sign in
            </Link>
          </div>
        ) : !invite ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={invite.email}
                disabled
                className={`${WORKFLOW_INPUT_CLASS} bg-slate-50 text-slate-500`}
              />
            </div>
            <div>
              <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
                Full name
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
            <button
              type="submit"
              disabled={submitting}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full justify-center disabled:opacity-60`}
            >
              {submitting ? 'Joining…' : 'Join organization'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
