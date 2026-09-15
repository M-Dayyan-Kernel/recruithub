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
            <p className="mb-2 text-[0.9rem] font-semibold text-warn">Room error</p>
            <p className="max-w-md break-all font-mono text-[0.75rem] text-ink-muted">
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

/** One participant's panel. The pair sit side by side, equal weight. */
function Tile({
  label,
  status,
  active,
  children,
}: {
  label: string
  status?: string
  active?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border bg-panel transition-colors duration-300 ${
        active ? 'border-accent shadow-md shadow-accent/10' : 'border-line'
      }`}
    >
      <div className="relative aspect-video w-full bg-panel-alt">{children}</div>
      <div className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-2.5">
        <p className="truncate font-display text-[0.86rem] font-semibold text-ink">{label}</p>
        {status && (
          <p className={`shrink-0 text-[0.76rem] ${active ? 'text-accent' : 'text-ink-muted'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The interviewer's half. There is no question text to show - the interview is
 * a live spoken conversation, so the state of the voice is the status.
 */
function AgentTile({ participant }: { participant?: RemoteParticipant }) {
  if (!participant) {
    return (
      <Tile label="AI Interviewer" status="Joining">
        <div className="flex h-full items-center justify-center">
          <AiOrb connecting size={132} />
        </div>
      </Tile>
    )
  }
  return <AgentSpeakingTile participant={participant} />
}

/** Split out: useIsSpeaking needs a participant that has actually joined. */
function AgentSpeakingTile({ participant }: { participant: RemoteParticipant }) {
  const speaking = useIsSpeaking(participant)
  return (
    <Tile
      label="AI Interviewer"
      status={speaking ? 'Speaking' : 'Listening to you'}
      active={speaking}
    >
      <div className="flex h-full items-center justify-center">
        <AiOrb speaking={speaking} size={132} />
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
      className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-[9px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
        danger
          ? 'border-warn bg-warn text-white hover:opacity-90'
          : 'border-line bg-panel text-ink-muted hover:bg-panel-alt disabled:opacity-50'
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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/40 p-6">
      <div className="w-full max-w-sm rounded-[14px] border border-line bg-panel p-6 shadow-xl">
        <h2 className="mb-1.5 font-display text-[1.05rem] font-semibold text-ink">
          End this interview?
        </h2>
        <p className="mb-5 text-[0.86rem] leading-relaxed text-ink-muted">
          Your answers so far are submitted for review. You cannot rejoin afterwards.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={ending}
            className="h-11 flex-1 cursor-pointer rounded-[9px] border border-line bg-panel text-[0.9rem] font-semibold text-ink transition-colors hover:bg-panel-alt disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={ending}
            className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-warn text-[0.9rem] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
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
    <div className="relative flex flex-1 select-none flex-col overflow-hidden bg-page bg-app font-sans">
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
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-panel/95">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={20} className="animate-spin text-accent" aria-hidden />
            <p className="text-[0.92rem] text-ink">Reconnecting</p>
            <p className="text-[0.8rem] text-ink-muted">Please keep this tab open</p>
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

      {/* Status bar - recording state left, session state right (mockup step 7). */}
      <div className="flex w-full flex-none items-center justify-between border-b border-line px-5 py-3 text-[0.72rem] text-ink-muted sm:px-8">
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-[7px] w-[7px]" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" />
            <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-warn" />
          </span>
          Recording
        </span>
        <span>Monitored session</span>
      </div>

      {/* Interviewer and candidate side by side, equal weight. */}
      <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="flex w-full max-w-5xl flex-col items-stretch gap-4 sm:flex-row">
          <AgentTile participant={agent} />

          <Tile label="You" status={isMicrophoneEnabled ? undefined : 'Muted'}>
            {cameraTrackRef && isCameraEnabled ? (
              <VideoTrack
                trackRef={cameraTrackRef}
                className="h-full w-full scale-x-[-1] object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <VideoOff size={22} className="text-ink-muted" aria-hidden />
              </div>
            )}
            {!isMicrophoneEnabled && (
              <span className="absolute right-2 top-2 rounded bg-ink/70 p-1.5">
                <MicOff size={12} className="text-white" aria-hidden />
              </span>
            )}
          </Tile>
        </div>
      </div>

      {/* Action bar, right-aligned as in the mockup. */}
      <div className="flex w-full flex-none items-center justify-end gap-2 border-t border-line px-5 py-3 sm:px-8">
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
            isCameraEnabled ? 'Your camera stays on for the whole interview' : 'Turn camera back on'
          }
        >
          {isCameraEnabled ? <Video size={17} /> : <VideoOff size={17} />}
        </ControlButton>

        <button
          onClick={() => setConfirmEnd(true)}
          className="ml-1 inline-flex h-11 cursor-pointer items-center gap-2 rounded-[9px] bg-warn px-5 text-[0.9rem] font-semibold text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn focus-visible:ring-offset-2"
        >
          <PhoneOff size={15} aria-hidden />
          End interview
        </button>
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
      <div className="flex flex-1 items-center justify-center bg-page bg-app p-6">
        <div className="max-w-sm text-center">
          <h2 className="mb-1.5 font-display text-[1.05rem] font-semibold text-ink">
            Interview already in progress
          </h2>
          <p className="mb-6 text-[0.86rem] leading-relaxed text-ink-muted">
            This session was already started. Go back to run the checks again and rejoin.
          </p>
          <button
            onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="h-11 cursor-pointer rounded-[9px] bg-accent px-5 text-[0.9rem] font-semibold text-accent-ink transition-colors hover:bg-primary-700"
          >
            Rejoin interview
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-page">
        <div className="flex flex-col items-center gap-2 text-ink-muted">
          <Loader2 size={20} className="animate-spin" aria-hidden />
          <p className="text-[0.9rem]">Connecting to your interview</p>
        </div>
      </div>
    )
  }

  if (error || !credentials) {
    return (
      <div className="flex flex-1 items-center justify-center bg-page bg-app p-6">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-4 h-6 w-6 text-warn" aria-hidden />
          <h2 className="mb-1.5 font-display text-[1.05rem] font-semibold text-ink">Could not connect</h2>
          <p className="mb-6 text-[0.86rem] leading-relaxed text-ink-muted">
            {error ?? 'Unable to connect. Please try again.'}
          </p>
          <button
            onClick={() => navigate(`/interview/${token ?? ''}`)}
            className="h-11 cursor-pointer rounded-[9px] border border-line bg-panel px-5 text-[0.9rem] font-semibold text-ink transition-colors hover:bg-panel-alt"
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
