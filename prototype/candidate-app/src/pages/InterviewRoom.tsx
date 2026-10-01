import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Mic, MicOff, PhoneOff } from 'lucide-react'

function AIWaveform({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex items-end gap-1 h-8">
      {[3, 6, 9, 5, 8, 4, 7, 3, 6, 9, 5].map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-150 ${speaking ? 'bg-indigo-400' : 'bg-slate-600'}`}
          style={{
            height: speaking ? `${h * 3 + Math.random() * 8}px` : '4px',
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))}
    </div>
  )
}

const TRANSCRIPT = [
  { role: 'ai', text: "Hi Arjun! I'm your AI interviewer today. Welcome, and thank you for taking the time. Let's start — can you walk me through your most recent role at Razorpay and what you worked on?" },
  { role: 'candidate', text: "Sure! At Razorpay I was a Senior Frontend Developer focused on the merchant dashboard. I led the migration from our legacy AngularJS codebase to React with TypeScript..." },
  { role: 'ai', text: "That sounds like a significant migration. How did you manage the gradual transition while keeping the product stable for existing merchants?" },
  { role: 'candidate', text: "We used a micro-frontend approach — we ran both apps in parallel, using a feature flag system to route users to the new React modules incrementally..." },
]

export default function InterviewRoom() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [aiSpeaking, setAiSpeaking] = useState(true)
  const [showEnd, setShowEnd] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000)
    const toggle = setInterval(() => setAiSpeaking(s => !s), 3000)
    return () => { clearInterval(timer); clearInterval(toggle) }
  }, [])

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-slate-300">Interview in progress</span>
        </div>
        <span className="text-sm font-mono text-slate-400">{fmt(elapsed)}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main interview area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* AI avatar */}
          <div className="mb-6 text-center">
            <div className="relative w-28 h-28 mx-auto mb-4">
              <div className={`absolute inset-0 rounded-full ${aiSpeaking ? 'bg-indigo-500/20 animate-ping' : ''}`} />
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-900 flex items-center justify-center border-2 border-indigo-500">
                <span className="text-4xl">🤖</span>
              </div>
            </div>
            <p className="text-white font-semibold">Olympus AI Interviewer</p>
            <p className="text-slate-400 text-sm mt-0.5">{aiSpeaking ? 'Speaking…' : 'Listening…'}</p>
            <div className="flex justify-center mt-2">
              <AIWaveform speaking={aiSpeaking} />
            </div>
          </div>

          {/* Current question */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-lg w-full text-center mb-8">
            <p className="text-xs text-slate-500 mb-2">Current question</p>
            <p className="text-slate-200 text-sm">{TRANSCRIPT[2].text}</p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            <button onClick={() => setMuted(!muted)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-700 hover:bg-slate-600'}`}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button onClick={() => setShowEnd(true)}
              className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center transition-colors">
              <PhoneOff size={20} />
            </button>
          </div>
          {muted && <p className="text-xs text-rose-400 mt-2">Microphone muted</p>}
        </div>

        {/* Transcript panel */}
        <div className="w-80 border-l border-slate-800 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-sm font-medium text-slate-300">Transcript</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {TRANSCRIPT.map((t, i) => (
              <div key={i} className={`text-xs rounded-xl p-3 ${t.role === 'ai' ? 'bg-slate-800 text-slate-300' : 'bg-indigo-900/30 text-indigo-200 ml-4'}`}>
                <p className="font-semibold mb-1 text-slate-500">{t.role === 'ai' ? 'AI Interviewer' : 'You'}</p>
                {t.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* End interview modal */}
      {showEnd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
            <h2 className="text-lg font-bold text-white mb-2">End Interview?</h2>
            <p className="text-slate-400 text-sm mb-6">Are you sure you want to end the interview? Your responses will be submitted for evaluation.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowEnd(false)} className="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-xl text-sm hover:bg-slate-800">Continue</button>
              <button onClick={() => navigate(`/interview/${token}/complete`)} className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-medium">End Interview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
