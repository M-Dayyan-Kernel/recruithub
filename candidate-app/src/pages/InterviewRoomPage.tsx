import { useEffect, useState, useCallback, useRef, Component, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle, Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useRemoteParticipants,
  useLocalParticipant,
  useIsSpeaking,
} from '@livekit/components-react'
import { ConnectionState, Track, type RemoteParticipant } from 'livekit-client'
import type { TrackReference } from '@livekit/components-react'
import '@livekit/components-styles'
import { api } from '@/lib/api'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-rose-400 font-bold mb-2">Room error (check console)</p>
          <p className="text-slate-400 text-xs font-mono break-all max-w-md">{this.state.error}</p>
        </div>
      </div>
    )
    return this.props.children
  }
}

interface RoomCredentials {
  room_name: string
  token: string
  livekit_url: string
}

// ---------------------------------------------------------------------------
// Animated waveform — pure CSS, no hook dependencies
// ---------------------------------------------------------------------------
function WaveformBars() {
  return (
    <div className="flex items-end justify-center gap-1.5 h-12" aria-hidden>
      {[40, 56, 48, 64, 48, 56, 40, 56, 48].map((h, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-indigo-400"
          style={{
            height: `${h}%`,
            animation: `waveform 1.2s ease-in-out ${i * 0.1}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes waveform {
          from { transform: scaleY(0.3); opacity: 0.5; }
          to   { transform: scaleY(1);   opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// End interview confirmation dialog
// ---------------------------------------------------------------------------
function ConfirmEndDialog({
  onCancel,
  onConfirm,
  ending,
}: {
  onCancel: () => void
  onConfirm: () => void
  ending: boolean
}) {
  return (
    <div className="absolute inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-bold text-slate-100 mb-2">End Interview?</h3>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          Are you sure you want to end the interview? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={ending}
            className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 text-sm font-medium rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={ending}
            className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors inline-flex items-center justify-center gap-2"
          >
            {ending ? <><Loader2 size={14} className="animate-spin" /> Ending…</> : 'End Interview'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AgentWaiting — shown before agent joins
// ---------------------------------------------------------------------------
function AgentWaiting() {
  return (
    <>
      <div className="w-32 h-32 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-4">
        <span className="text-5xl select-none">🤖</span>
      </div>
      <div className="h-12 mb-3" />
      <p className="text-sm text-slate-400 mb-8 text-center">Waiting for AI interviewer to join…</p>
    </>
  )
}

// ---------------------------------------------------------------------------
// AgentDisplay — shown when agent is in the room (useIsSpeaking safe here)
// ---------------------------------------------------------------------------
function AgentDisplay({ participant }: { participant: RemoteParticipant }) {
  const isAgentSpeaking = useIsSpeaking(participant)
  const [thinking, setThinking] = useState(false)
  const wasSpeaking = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isAgentSpeaking) {
      if (timer.current) clearTimeout(timer.current)
      setThinking(false)
      wasSpeaking.current = true
    } else if (wasSpeaking.current) {
      setThinking(true)
      timer.current = setTimeout(() => setThinking(false), 2500)
      wasSpeaking.current = false
    }
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [isAgentSpeaking])

  const statusText = isAgentSpeaking ? 'AI Interviewer is speaking…'
    : thinking ? 'AI is thinking…'
    : 'Speak now — AI is listening'

  return (
    <>
      <div className="relative flex items-center justify-center mb-4">
        {isAgentSpeaking && (
          <span className="absolute inset-0 rounded-full border-2 border-indigo-400 animate-ping opacity-30 scale-125" />
        )}
        <div className={`w-32 h-32 rounded-full bg-slate-800 border-2 flex items-center justify-center transition-colors duration-500 ${
          isAgentSpeaking ? 'border-indigo-400' : 'border-slate-700'
        }`}>
          <span className="text-5xl select-none">🤖</span>
        </div>
      </div>
      <div className="h-12 flex items-center mb-3">
        {isAgentSpeaking ? <WaveformBars /> : <div className="h-12" />}
      </div>
      <p className="text-sm text-slate-400 mb-8 text-center">{statusText}</p>
    </>
  )
}

// ---------------------------------------------------------------------------
// InterviewRoom — inner UI (runs inside LiveKitRoom context)
// ---------------------------------------------------------------------------
function InterviewRoom({ token }: { token: string }) {
  const navigate = useNavigate()
  const connectionState = useConnectionState()
  const remoteParticipants = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, cameraTrack } = useLocalParticipant()

  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)

  // Warn before leaving while interview is in progress
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const agentParticipant = remoteParticipants[0] as RemoteParticipant | undefined

  const handleEndConfirm = useCallback(async () => {
    if (ending) return
    setEnding(true)
    try { await api.post(`/api/interview/${token}/complete`) } catch { /* best-effort */ }
    navigate(`/interview/${token}/complete`)
  }, [ending, token, navigate])

  // Self-view camera track reference
  const cameraTrackRef: TrackReference | null =
    cameraTrack && localParticipant
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : null

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* Reconnecting overlay */}
      {connectionState === ConnectionState.Reconnecting && (
        <div className="absolute inset-0 z-40 bg-slate-950/85 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-indigo-400" />
            <p className="text-slate-300 text-sm font-medium">Reconnecting…</p>
            <p className="text-slate-500 text-xs">Please wait, do not close this tab</p>
          </div>
        </div>
      )}

      {/* End interview confirmation */}
      {confirmEnd && (
        <ConfirmEndDialog
          onCancel={() => setConfirmEnd(false)}
          onConfirm={handleEndConfirm}
          ending={ending}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Recording badge */}
        <div className="flex items-center gap-2 mb-6">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400 font-semibold uppercase tracking-wider">Recording</span>
        </div>

        {/* Side-by-side on md+, stacked on mobile: AI avatar + candidate video */}
        <div className="flex flex-col md:flex-row items-stretch justify-center gap-4 md:gap-6 w-full max-w-2xl mb-6">
          {/* AI side */}
          <div className="flex-1 w-full md:w-1/2 flex flex-col items-center justify-center bg-slate-900 border border-slate-700 rounded-2xl p-6 min-h-[240px]">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-3 font-medium">AI Interviewer</p>
            {agentParticipant
              ? <AgentDisplay participant={agentParticipant} />
              : <AgentWaiting />}
          </div>

          {/* Candidate video side */}
          <div className="flex-1 w-full md:w-1/2 flex flex-col items-center justify-center bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden min-h-[240px] relative">
            <p className="absolute top-3 left-0 right-0 text-center text-xs text-slate-500 uppercase tracking-widest font-medium z-10">You</p>
            {cameraTrackRef && isCameraEnabled ? (
              <VideoTrack trackRef={cameraTrackRef} className="w-full h-full object-cover scale-x-[-1]" />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center">
                  <VideoOff size={28} className="text-slate-500" />
                </div>
                <p className="text-xs text-slate-500">Camera off</p>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
            title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
            className={`min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isMicrophoneEnabled ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-rose-700 hover:bg-rose-600 text-white'
            }`}
          >
            {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
          </button>

          <button
            onClick={() => localParticipant?.setCameraEnabled(!isCameraEnabled)}
            title={isCameraEnabled ? 'Camera off' : 'Camera on'}
            className={`min-w-[44px] min-h-[44px] w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isCameraEnabled ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-rose-700 hover:bg-rose-600 text-white'
            }`}
          >
            {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
          </button>

          <button
            onClick={() => setConfirmEnd(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <PhoneOff size={15} /> End Interview
          </button>
        </div>
      </div>


    </div>
  )
}

// ---------------------------------------------------------------------------
// InterviewRoomPage — outer shell (fetches credentials, mounts LiveKitRoom)
// ---------------------------------------------------------------------------
export default function InterviewRoomPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roomReady, setRoomReady] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function startInterview() {
      if (!token) { setError('No interview token.'); setLoading(false); return }
      try {
        const data = (await api.post(`/api/interview/${token}/start`)) as RoomCredentials
        setCredentials(data)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        // api.ts strips HTTP status — detect 409 by message content
        if (msg.toLowerCase().includes('already started') || msg.toLowerCase().includes('not in pending')) {
          // Session already started — this is fine, show rejoin UI
          setRoomReady(true)
          return
        }
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    startInterview()
  }, [token])

  // 409 path: interview already in progress — send user to landing page rejoin screen
  if (roomReady && !credentials) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-10 h-10 rounded-full bg-indigo-900 flex items-center justify-center mx-auto mb-4">
            <span className="text-indigo-400 text-xl">↩</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">Interview Already In Progress</h2>
          <p className="text-slate-400 text-sm mb-6">
            Your interview session was already started.
          </p>
          <button
            onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl"
          >
            Rejoin Interview
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">Connecting to interview room…</p>
        </div>
      </div>
    )
  }

  if (error || !credentials) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-100 mb-2">Failed to Connect</h2>
          <p className="text-slate-400 text-sm mb-6">{error ?? 'Unable to connect. Please try again.'}</p>
          <button onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm font-medium rounded-xl">
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <LiveKitRoom
        serverUrl={credentials.livekit_url}
        token={credentials.token}
        connect={true}
        audio={true}
        video={true}
        className="flex-1 flex flex-col"
      >
        <RoomAudioRenderer />
        <ErrorBoundary>
          <InterviewRoom token={token ?? ''} />
        </ErrorBoundary>
      </LiveKitRoom>
    </div>
  )
}
