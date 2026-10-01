import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Mic,
  Wifi,
  MapPin,
  Clock,
  Video,
  ShieldAlert,
} from 'lucide-react'
import { api } from '@/lib/api'

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
}

// ---------------------------------------------------------------------------
// Rejoin screen — interview already in progress
// ---------------------------------------------------------------------------

function RejoinScreen({ onRejoin }: { onRejoin: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-indigo-900/40 flex items-center justify-center mx-auto mb-4">
          <Video className="w-7 h-7 text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">Interview In Progress</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          Your interview is in progress. Click below to rejoin.
        </p>
        <button
          onClick={onRejoin}
          className="w-full py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-base transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Rejoin Interview
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expired screen
// ---------------------------------------------------------------------------

function ExpiredScreen() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">Interview Link Expired</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          This interview link has expired. Please contact the hiring team to receive a new link.
        </p>
      </div>
    </div>
  )
}

type PermissionState = 'idle' | 'checking' | 'granted' | 'denied'

// ---------------------------------------------------------------------------
// InterviewLandingPage
// ---------------------------------------------------------------------------

export default function InterviewLandingPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [info, setInfo] = useState<InterviewInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [is404, setIs404] = useState(false)

  const [permissionState, setPermissionState] = useState<PermissionState>('idle')

  // ── Fetch interview info ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function fetchInterview() {
      if (!token) {
        setError('No interview token provided.')
        setLoading(false)
        return
      }

      try {
        const data = (await api.get(`/api/interview/${token}`)) as InterviewInfo
        if (!cancelled) {
          setInfo(data)
          setLoading(false)
        }
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

    fetchInterview()
    return () => {
      cancelled = true
    }
  }, [token])

  // ── Permission check ──────────────────────────────────────────────────────
  const handleCheckPermissions = async () => {
    setPermissionState('checking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      // Stop all tracks immediately — we only needed to trigger the permission prompt
      stream.getTracks().forEach((t) => t.stop())
      setPermissionState('granted')
    } catch {
      setPermissionState('denied')
    }
  }

  const handleStart = () => {
    navigate(`/interview/${token}/room`)
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">Loading your interview…</p>
        </div>
      </div>
    )
  }

  // ── Error / 404 ───────────────────────────────────────────────────────────
  if (error || !info) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-slate-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {is404 ? 'Invalid Interview Link' : 'Something went wrong'}
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            {is404
              ? 'This interview link is invalid or has expired. Please contact the hiring team if you believe this is a mistake.'
              : 'We encountered an error loading your interview. Please try again or contact support.'}
          </p>
        </div>
      </div>
    )
  }

  // ── In progress — rejoin ──────────────────────────────────────────────────
  if (info.status === 'in_progress') {
    return (
      <RejoinScreen
        onRejoin={() => navigate(`/interview/${token}/room`)}
      />
    )
  }

  // ── Expired ───────────────────────────────────────────────────────────────
  if (info.status === 'expired') {
    return <ExpiredScreen />
  }

  // ── Already completed ─────────────────────────────────────────────────────
  if (info.status === 'completed') {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">Interview Already Completed</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            You have already completed this interview. Thank you for your time! The hiring team
            will be in touch soon.
          </p>
        </div>
      </div>
    )
  }

  // ── Pending — show landing ────────────────────────────────────────────────
  const instructions = [
    {
      icon: MapPin,
      text: 'Find a quiet place with a good internet connection',
    },
    {
      icon: Mic,
      text: 'Allow camera and microphone access when prompted by your browser',
    },
    {
      icon: Wifi,
      text: 'The AI interviewer will guide the conversation — speak clearly and naturally',
    },
    {
      icon: Clock,
      text: 'Expected duration: 15–20 minutes',
    },
  ]

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Job title */}
        <div className="text-center mb-8">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-2">
            AI Interview
          </p>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">
            {info.job_title ?? 'Interview'}
          </h1>
          {info.candidate_name && (
            <p className="text-slate-300">
              Hello, <span className="font-medium">{info.candidate_name}</span>!
            </p>
          )}
        </div>

        {/* Instructions card */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 mb-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Before you begin
          </h2>
          <ul className="space-y-3">
            {instructions.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="mt-0.5 w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-indigo-400" />
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{text}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Recording notice */}
        <div className="flex items-start gap-2 bg-slate-900/60 border border-slate-700/60 rounded-xl px-4 py-3 mb-6">
          <Video size={14} className="text-slate-500 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            This interview will be recorded (audio and video) and analysed by AI. Your responses
            will be reviewed by the hiring team.
          </p>
        </div>

        {/* Permission check + start button */}
        {permissionState === 'idle' && (
          <button
            onClick={handleCheckPermissions}
            className="w-full py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-base transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950 inline-flex items-center justify-center gap-2"
          >
            <Video size={18} />
            Allow Camera &amp; Microphone
          </button>
        )}

        {permissionState === 'checking' && (
          <button
            disabled
            className="w-full py-3.5 px-6 bg-indigo-600/60 text-white/60 font-semibold rounded-xl text-base cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Loader2 size={18} className="animate-spin" />
            Checking permissions…
          </button>
        )}

        {permissionState === 'denied' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-rose-950/40 border border-rose-800/50 rounded-xl px-4 py-3">
              <ShieldAlert size={16} className="text-rose-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-rose-300 mb-1">Permission denied</p>
                <p className="text-xs text-rose-400/80 leading-relaxed">
                  Please allow camera and microphone access to continue. Check your browser's
                  address bar or site settings and reload the page once access is granted.
                </p>
              </div>
            </div>
            <button
              onClick={handleCheckPermissions}
              className="w-full py-3 px-6 bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium rounded-xl text-sm transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {permissionState === 'granted' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 text-sm justify-center mb-1">
              <CheckCircle2 size={16} />
              <span>Camera &amp; microphone access granted</span>
            </div>
            <button
              onClick={handleStart}
              className="w-full py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-base transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Start Interview
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 mt-4">
          By starting, you agree to the recording and AI analysis of this interview session.
        </p>
      </div>
    </div>
  )
}
