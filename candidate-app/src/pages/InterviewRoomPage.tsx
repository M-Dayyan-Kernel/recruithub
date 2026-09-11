import { useCallback, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'
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
import { api, getRetryAfterMinutes, isInterviewCapacityError } from '@/lib/api'
import InterviewBusyScreen from '@/components/InterviewBusyScreen'
import AiOrb from '@/components/AiOrb'
import { EndedNotice, RecoveryPrompts, WarningNotice } from '@/components/ProctorOverlays'
import { useActiveProctoring } from '@/hooks/useProctoring'
import { exitFullscreen, isFullscreen } from '@/proctoring/browser'
import { getProctorSession } from '@/proctoring/session'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message }
  }
  render() {
    if (this.state.error)
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <p className="mb-2 text-sm font-medium text-rose-400">Room error</p>
            <p className="max-w-md break-all font-mono text-xs text-slate-500">
              {this.state.error}
            </p>
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

function findAgentParticipant(participants: RemoteParticipant[]): RemoteParticipant | undefined {
  return participants.find(
    (p) =>
      p.identity.toLowerCase().includes('agent') ||
      (p.name ?? '').toLowerCase().includes('interviewer'),
  )
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function Tile({
  label,
  children,
  active,
}: {
  label: string
  children: ReactNode
  active?: boolean
}) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl border bg-slate-900/50 backdrop-blur-sm transition-colors duration-300 ${
        active ? 'border-indigo-400/60 shadow-lg shadow-indigo-500/10' : 'border-white/10'
      }`}
    >
      {children}
      <span className="absolute bottom-3 left-4 rounded-full bg-slate-950/60 px-2.5 py-1 text-[11px] font-medium text-slate-300 backdrop-blur">
        {label}
      </span>
    </div>
  )
}

/** Split in two: useIsSpeaking needs a real participant, so it can only be
 *  called once the agent has actually joined the room. */
function AgentJoined({ participant }: { participant: RemoteParticipant }) {
  const speaking = useIsSpeaking(participant)
  return (
    <Tile label="AI Interviewer" active={speaking}>
      <div className="flex h-full flex-col items-center justify-center gap-3 pb-7">
        <AiOrb speaking={speaking} size={104} />
        <p className={`text-[13px] ${speaking ? 'text-indigo-200' : 'text-slate-400'}`}>
          {speaking ? 'Speaking' : 'Listening to you'}
        </p>
      </div>
    </Tile>
  )
}

function AgentTile({ participant }: { participant?: RemoteParticipant }) {
  if (participant) return <AgentJoined participant={participant} />
  return (
    <Tile label="AI Interviewer">
      <div className="flex h-full flex-col items-center justify-center gap-3 pb-7">
        <AiOrb connecting size={104} />
        <p className="text-[13px] text-slate-400">Joining your interview</p>
      </div>
    </Tile>
  )
}

function ControlButton({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed ${
        danger
          ? 'bg-rose-600/90 text-white hover:bg-rose-500'
          : 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-60 disabled:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  )
}

function ConfirmEnd({
  onCancel,
  onConfirm,
  ending,
}: {
  onCancel: () => void
  onConfirm: () => void
  ending: boolean
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/92 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-1.5 text-base font-medium text-slate-100">End this interview?</h2>
        <p className="mb-5 text-sm leading-relaxed text-slate-400">
          Your answers so far are submitted for review. You cannot rejoin afterwards.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={ending}
            className="h-10 flex-1 cursor-pointer rounded-md bg-slate-800 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={ending}
            className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-rose-600 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
          >
            {ending && <Loader2 size={14} className="animate-spin" aria-hidden />}
            End interview
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

function InterviewRoom({ token }: { token: string }) {
  const navigate = useNavigate()
  const connectionState = useConnectionState()
  const remoteParticipants = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, cameraTrack } =
    useLocalParticipant()

  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const agent = findAgentParticipant(remoteParticipants)

  /** Closes the session server side, then leaves the room. */
  const finishInterview = useCallback(async () => {
    if (finishedRef.current) return
    finishedRef.current = true
    setEnding(true)

    const session = getProctorSession(token)
    session.setState('SESSION_COMPLETION')
    session.engine.closeAll('session_completion')
    await session.transport.flush(() => {
      const snap = session.engine.snapshot()
      const state = session.snapshot()
      return {
        events: snap.events,
        signals: snap.signals,
        preconditions: state.preconditions,
        attempts: state.attempts,
      }
    })

    try {
      await api.post(`/api/interview/${token}/complete`)
    } catch {
      /* best effort, LiveKit room_finished is the server side backstop */
    }

    session.releaseAll()
    await exitFullscreen()
    navigate(`/interview/${token}/complete`)
  }, [token, navigate])

  const handlePolicyEnd = useCallback(() => {
    void localParticipant?.setMicrophoneEnabled(false)
    void localParticipant?.setCameraEnabled(false)
    void finishInterview()
  }, [localParticipant, finishInterview])

  const proctor = useActiveProctoring(token, true, handlePolicyEnd)
  const endedReason = proctor.session.getEndedReason()

  // PR-STATE-016: leaving without submitting is abandonment, not a completion.
  // The state is recorded and what was captured is kept, but the session never
  // routes through completion or review.
  useEffect(() => {
    const markAbandoned = () => {
      if (finishedRef.current) return
      const session = getProctorSession(token)
      if (session.getState() !== 'PROCTORING_ACTIVE') return
      session.engine.closeAll('abandoned')
      session.setState('INCOMPLETE')
    }
    window.addEventListener('pagehide', markAbandoned)
    return () => {
      window.removeEventListener('pagehide', markAbandoned)
      markAbandoned()
    }
  }, [token])

  // Camera and microphone interruptions come from the published tracks. The
  // first report is skipped: tracks are not published the instant we mount.
  const { reportCamera, reportMicrophone } = proctor
  const cameraSeen = useRef(false)
  const micSeen = useRef(false)

  useEffect(() => {
    if (isCameraEnabled) cameraSeen.current = true
    if (cameraSeen.current) reportCamera(isCameraEnabled)
  }, [isCameraEnabled, reportCamera])

  useEffect(() => {
    if (isMicrophoneEnabled) micSeen.current = true
    if (micSeen.current) reportMicrophone(isMicrophoneEnabled)
  }, [isMicrophoneEnabled, reportMicrophone])

  const cameraTrackRef: TrackReference | null =
    cameraTrack && localParticipant
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : null

  return (
    <div className="relative flex flex-1 select-none flex-col overflow-hidden bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,#312e81_0%,#0b1020_45%,#020617_100%)]">
      {endedReason ? (
        <EndedNotice reason={endedReason} />
      ) : (
        <>
          <RecoveryPrompts
            prompts={proctor.snapshot.prompts}
            onFullscreen={() => void proctor.recoverFullscreen()}
            onScreenShare={() => void proctor.recoverScreenShare()}
          />
          {proctor.warning && proctor.snapshot.prompts.length === 0 && (
            <WarningNotice
              message={proctor.warning.message}
              remaining={proctor.warning.remaining}
              onDismiss={proctor.dismissWarning}
            />
          )}
        </>
      )}

      {connectionState === ConnectionState.Reconnecting && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/90">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={20} className="animate-spin text-slate-400" aria-hidden />
            <p className="text-sm text-slate-300">Reconnecting</p>
            <p className="text-xs text-slate-500">Please keep this tab open</p>
          </div>
        </div>
      )}

      {confirmEnd && (
        <ConfirmEnd
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => void finishInterview()}
          ending={ending}
        />
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-4xl items-center justify-between text-[12px] text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            Recording
          </span>
          <span>Monitored session</span>
        </div>

        <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2">
          <AgentTile participant={agent} />

          <Tile label="You">
            {cameraTrackRef && isCameraEnabled ? (
              <VideoTrack
                trackRef={cameraTrackRef}
                className="h-full w-full scale-x-[-1] object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <VideoOff size={20} className="text-slate-600" aria-hidden />
              </div>
            )}
            {!isMicrophoneEnabled && (
              <span className="absolute right-2 top-2 rounded bg-slate-950/80 p-1.5">
                <MicOff size={13} className="text-slate-400" aria-hidden />
              </span>
            )}
          </Tile>
        </div>

        <div className="flex items-center gap-2">
          <ControlButton
            onClick={() => void localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
            label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isMicrophoneEnabled ? <Mic size={17} /> : <MicOff size={17} />}
          </ControlButton>

          <ControlButton
            onClick={() => {
              if (!isCameraEnabled) void localParticipant?.setCameraEnabled(true)
            }}
            disabled={isCameraEnabled}
            label={
              isCameraEnabled
                ? 'Your camera stays on for the whole interview'
                : 'Turn camera back on'
            }
          >
            {isCameraEnabled ? <Video size={17} /> : <VideoOff size={17} />}
          </ControlButton>

          <button
            onClick={() => setConfirmEnd(true)}
            className="ml-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-rose-600/90 px-5 text-sm font-medium text-white transition-colors hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <PhoneOff size={15} aria-hidden />
            End interview
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function InterviewRoomPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [credentials, setCredentials] = useState<RoomCredentials | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capacityBusy, setCapacityBusy] = useState(false)
  const [retryAfterMinutes, setRetryAfterMinutes] = useState(45)
  const [rejoinNeeded, setRejoinNeeded] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // The pre-flight gate is checked once, before the room is created. A missing
    // precondition sends the candidate back to the gate that failed; it never
    // ends anything. A fullscreen exit later on is handled inside the room.
    const proctorSession = getProctorSession(token ?? '')
    if (!isFullscreen()) proctorSession.reset('fullscreen')
    if (!proctorSession.canEnterActive()) {
      navigate(`/interview/${token ?? ''}`, { replace: true })
      return
    }

    async function startInterview() {
      if (!token) {
        setError('No interview token.')
        setLoading(false)
        return
      }
      try {
        const data = (await api.post(`/api/interview/${token}/start`)) as RoomCredentials
        getProctorSession(token).setState('PROCTORING_ACTIVE')
        setCredentials(data)
      } catch (err: unknown) {
        if (isInterviewCapacityError(err)) {
          setCapacityBusy(true)
          setRetryAfterMinutes(getRetryAfterMinutes(err))
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        if (
          msg.toLowerCase().includes('already started') ||
          msg.toLowerCase().includes('not in pending')
        ) {
          setRejoinNeeded(true)
          return
        }
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    startInterview()
  }, [token, navigate])

  if (capacityBusy) {
    return (
      <InterviewBusyScreen
        retryAfterMinutes={retryAfterMinutes}
        onRetry={() => navigate(`/interview/${token ?? ''}`)}
      />
    )
  }

  if (rejoinNeeded && !credentials) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="mb-1.5 text-base font-medium text-slate-100">
            Interview already in progress
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-slate-400">
            This session was already started. Go back to run the checks again and rejoin.
          </p>
          <button
            onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="h-10 cursor-pointer rounded-md bg-indigo-600 px-5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Rejoin interview
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <Loader2 size={20} className="animate-spin" aria-hidden />
          <p className="text-sm">Connecting to your interview</p>
        </div>
      </div>
    )
  }

  if (error || !credentials) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-4 h-6 w-6 text-rose-400" aria-hidden />
          <h2 className="mb-1.5 text-base font-medium text-slate-100">Could not connect</h2>
          <p className="mb-6 text-sm leading-relaxed text-slate-400">
            {error ?? 'Unable to connect. Please try again.'}
          </p>
          <button
            onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="h-10 cursor-pointer rounded-md bg-slate-800 px-5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <LiveKitRoom
        serverUrl={credentials.livekit_url}
        token={credentials.token}
        connect={true}
        audio={true}
        video={true}
        className="flex flex-1 flex-col"
      >
        <RoomAudioRenderer />
        <ErrorBoundary>
          <InterviewRoom token={token ?? ''} />
        </ErrorBoundary>
      </LiveKitRoom>
    </div>
  )
}
