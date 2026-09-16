import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import InterviewBusyScreen from '@/components/InterviewBusyScreen'
import Preflight from '@/components/preflight/Preflight'
import { Screen, StatusScreen } from '@/components/Shell'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InterviewInfo {
  id: string
  unique_token: string
  status: 'pending' | 'in_progress' | 'completed' | 'expired'
  candidate_name?: string
  job_title?: string
  created_at: string
  mock_mode?: boolean
  capacity_available?: boolean | null
  retry_after_minutes?: number | null
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// InterviewLandingPage
//
// Session validation (§8.1) followed by the pre-flight gate sequence. Rejoining
// an in-progress session runs the gates again - the preconditions for
// PROCTORING_ACTIVE have to hold every time the room is entered.
// ---------------------------------------------------------------------------

export default function InterviewLandingPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [info, setInfo] = useState<InterviewInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [is404, setIs404] = useState(false)
  const [mockCompleting, setMockCompleting] = useState(false)
  const [refreshingCapacity, setRefreshingCapacity] = useState(false)

  const fetchInterviewInfo = async () => {
    if (!token) {
      setError('No interview token provided.')
      setLoading(false)
      return
    }

    const data = (await api.get(`/api/interview/${token}`)) as InterviewInfo
    setInfo(data)
    setError(null)
    setIs404(false)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        await fetchInterviewInfo()
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          const notFound =
            msg.includes('404') ||
            msg.toLowerCase().includes('not found') ||
            msg.toLowerCase().includes('invalid')
          setIs404(notFound)
          setError(msg)
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token])

  const handleRetryCapacity = async () => {
    if (!token) return
    setRefreshingCapacity(true)
    try {
      await fetchInterviewInfo()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setRefreshingCapacity(false)
    }
  }

  const handleMockComplete = async () => {
    if (!token) return
    setMockCompleting(true)
    try {
      await api.post(`/api/interview/${token}/complete`)
      navigate(`/interview/${token}/complete`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to complete mock interview'
      setError(msg)
      setMockCompleting(false)
    }
  }

  const handleReady = useCallback(() => {
    navigate(`/interview/${token}/room`)
  }, [navigate, token])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={22} className="animate-spin text-accent" aria-hidden />
          <p className="text-[0.92rem] text-ink-muted">Loading your interview</p>
        </div>
      </Screen>
    )
  }

  // Error / 404
  if (error || !info) {
    return (
      <StatusScreen
        icon={<AlertCircle size={22} />}
        tone="muted"
        title={is404 ? 'This interview link is not valid' : 'Something went wrong'}
        body={
          is404
            ? 'This link may have expired or been replaced. Get in touch if you think that is a mistake.'
            : 'We could not load your interview. Refresh the page, or get in touch if it keeps happening.'
        }
      />
    )
  }

  if (info.status === 'expired')
    return (
      <StatusScreen
        icon={<Clock size={22} />}
        tone="muted"
        title="This link has expired"
        body="Your interview link is no longer valid. The hiring team can send you a new one."
      />
    )

  if (info.status === 'completed')
    return (
      <StatusScreen
        icon={<CheckCircle2 size={22} />}
        tone="success"
        title="Interview already completed"
        body="Thank you for your time. The hiring team is reviewing your interview and will be in touch."
      />
    )

  // ── Capacity full (pending session) ───────────────────────────────────────
  if (info.status === 'pending' && info.capacity_available === false) {
    return (
      <InterviewBusyScreen
        retryAfterMinutes={info.retry_after_minutes ?? 45}
        onRetry={handleRetryCapacity}
        retrying={refreshingCapacity}
      />
    )
  }

  // ── Pre-flight (§8) - pending, or rejoining an in-progress session ─────────
  return (
    <div className="relative flex flex-1 flex-col">
      {info.mock_mode && (
        <div className="pointer-events-auto absolute left-1/2 top-4 z-20 w-full max-w-md -translate-x-1/2 px-4">
          <div className="flex items-center gap-3 rounded-[10px] border border-line bg-panel px-4 py-3 shadow-sm">
            <p className="text-[0.8rem] text-ink-muted">Mock mode: LiveKit is disabled.</p>
            <button
              type="button"
              onClick={handleMockComplete}
              disabled={mockCompleting}
              className="ml-auto shrink-0 cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[0.78rem] font-semibold text-accent-ink transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {mockCompleting ? 'Completing' : 'Skip to complete'}
            </button>
          </div>
        </div>
      )}

      <Preflight
        token={token ?? ''}
        candidateName={info.candidate_name}
        jobTitle={info.job_title}
        onReady={handleReady}
      />
    </div>
  )
}
