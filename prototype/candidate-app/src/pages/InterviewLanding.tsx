import { useParams, useNavigate } from 'react-router-dom'
import { Mic, Wifi, Volume2, ChevronRight } from 'lucide-react'

const sessions: Record<string, { candidateName: string; jobTitle: string; company: string }> = {
  'demo-token-arjun': { candidateName: 'Arjun Sharma', jobTitle: 'Senior Frontend Engineer', company: 'Webknot' },
  'demo-token-sneha': { candidateName: 'Sneha Patel', jobTitle: 'Senior Frontend Engineer', company: 'Webknot' },
}

export default function InterviewLanding() {
  const { token } = useParams()
  const navigate = useNavigate()
  const session = token ? sessions[token] : null

  if (!token || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-rose-500/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔗</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Interview Link</h1>
          <p className="text-slate-400 text-sm">This link is invalid or has expired. Please contact the HR team for a new link.</p>
        </div>
      </div>
    )
  }

  const checklist = [
    { icon: Mic, label: 'Find a quiet space with no background noise' },
    { icon: Wifi, label: 'Ensure you have a stable internet connection' },
    { icon: Volume2, label: 'Use headphones for the best audio experience' },
  ]

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white font-bold text-lg">O</span>
          </div>
          <p className="text-slate-400 text-sm">{session.company} · Powered by Olympus</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-1">Hi, {session.candidateName.split(' ')[0]}! 👋</h1>
            <p className="text-slate-400 text-sm">You're invited to interview for</p>
            <p className="text-indigo-400 font-semibold mt-1">{session.jobTitle}</p>
            <p className="text-slate-500 text-sm">at {session.company}</p>
          </div>

          <div className="space-y-3 mb-8">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Before you start</p>
            {checklist.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-sm text-slate-300">
                <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-indigo-400" />
                </div>
                {label}
              </div>
            ))}
          </div>

          <div className="bg-slate-800 rounded-xl p-4 mb-6">
            <p className="text-xs text-slate-400 text-center">
              This interview is conducted by an AI interviewer. It typically takes <strong className="text-white">20–30 minutes</strong>. Your responses will be evaluated and shared with the hiring team.
            </p>
          </div>

          <button onClick={() => navigate(`/interview/${token}/room`)}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors">
            Start Interview <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
