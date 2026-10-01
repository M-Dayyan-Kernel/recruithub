/**
 * Proctoring vocabulary - ScaleHR AI Proctoring PRD v1.0.
 *
 * The PRD keeps three concepts strictly separate and so does this code:
 *   State  - the lifecycle condition of the session (PR-STATE-001…016)
 *   Event  - something that happened, immutable (§11)
 *   Signal - an interpreted, deduplicated, severity-classified condition (§9)
 *
 * They are never collapsed into one object.
 */

// ---------------------------------------------------------------------------
// §7.1 Proctoring state machine
// ---------------------------------------------------------------------------

export type ProctorState =
  | 'SESSION_NOT_STARTED'
  | 'SESSION_VALIDATED'
  | 'CONSENT_PENDING'
  | 'SYSTEM_CHECK'
  | 'PERMISSION_ACQUISITION'
  | 'SCREEN_SHARE_VALIDATION'
  | 'ENVIRONMENT_PREPARATION'
  | 'FULLSCREEN_VALIDATION'
  | 'BASELINE_FACE_CAPTURE'
  | 'BASELINE_ESTABLISHED'
  | 'PROCTORING_ACTIVE'
  | 'SESSION_COMPLETION'
  | 'INCOMPLETE'

/**
 * Ordered pre-flight sequence (§8). PROCTORING_ACTIVE is gated on all of it.
 *
 * SYSTEM_CHECK and BASELINE_FACE_CAPTURE are deliberately not in this build:
 * the approved candidate screens drop both, so neither is presented and
 * neither gates the session. The states and their preconditions are kept in
 * the type so stored sessions from an earlier build still parse, and so
 * restoring either gate is a one-line change here plus in
 * MANDATORY_PRECONDITIONS.
 */
export const PREFLIGHT_SEQUENCE: ProctorState[] = [
  'CONSENT_PENDING',
  'PERMISSION_ACQUISITION',
  'SCREEN_SHARE_VALIDATION',
  'FULLSCREEN_VALIDATION',
  'ENVIRONMENT_PREPARATION',
]

// ---------------------------------------------------------------------------
// §19 Preconditions - each independently queryable and auditable (REQ-STATE-03)
// ---------------------------------------------------------------------------

export type PreconditionType =
  | 'consent'
  | 'system_check'
  | 'permission_camera'
  | 'permission_microphone'
  | 'permission_screen'
  | 'permission_location'
  | 'screen_share'
  | 'environment'
  | 'fullscreen'
  | 'baseline'

/**
 * The gates that must all pass before PROCTORING_ACTIVE (§8.1).
 *
 * 'permission_location' is optional by deployment. 'system_check' and
 * 'baseline' are absent because those screens are not part of this flow - were
 * they left here, canEnterActive() could never return true and no candidate
 * would ever reach the room.
 */
export const MANDATORY_PRECONDITIONS: PreconditionType[] = [
  'consent',
  'permission_camera',
  'permission_microphone',
  'permission_screen',
  'screen_share',
  'fullscreen',
  'environment',
]

export type PreconditionStatus = 'pending' | 'passed' | 'failed'

export interface PreconditionRecord {
  type: PreconditionType
  status: PreconditionStatus
  at: string | null
  failure_reason?: string | null
}

/** Every failed attempt is logged, not just outcomes (REQ-STATE-06). */
export interface PreconditionAttempt {
  attempt_id: string
  precondition_type: PreconditionType
  outcome: 'passed' | 'failed'
  failure_reason?: string | null
  at: string
}

// ---------------------------------------------------------------------------
// §9 / §10 Signals
// ---------------------------------------------------------------------------

export type Severity = 'informational' | 'soft' | 'hard'

export type SignalCategory =
  | 'identity'
  | 'behavior'
  | 'screen_browser'
  | 'device_media'
  | 'session_integrity'
  | 'audio'

export type SignalType =
  // §10.1 Identity - vision model, not detectable in the browser
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'FACE_MISMATCH'
  | 'FACE_VISIBILITY_DEGRADED'
  // §10.2 Candidate behavior - vision model
  | 'GAZE_AWAY'
  | 'SECONDARY_DEVICE_VISIBLE'
  | 'SUSTAINED_READING_GAZE'
  | 'REPEATED_GAZE_DEVIATIONS'
  // §10.3 Screen / browser
  | 'SCREEN_SHARE_INTERRUPTED'
  | 'SCREEN_SHARE_RESUMED'
  | 'FULLSCREEN_EXITED'
  | 'TAB_CHANGE'
  | 'WINDOW_CHANGE'
  // §10.4 Device / media
  | 'CAMERA_INTERRUPTED'
  | 'MICROPHONE_INTERRUPTED'
  // §10.5 Session integrity
  | 'NETWORK_INTERRUPTED'
  | 'MONITORING_INTERRUPTED'
  | 'RECORDING_INTERRUPTED'
  | 'MONITORING_RESUMED'
  // §10.6 Audio - voice diarization model
  | 'MULTIPLE_VOICES_DETECTED'
  | 'PROLONGED_SILENCE'
  // Out-of-registry browser observations (see registry.ts)
  | 'CLIPBOARD_USE'
  | 'DEVTOOLS_OPENED'
  | 'MULTIPLE_DISPLAYS'
  | 'VIRTUAL_CAMERA_PRESENT'
  | 'AUTOMATION_DETECTED'
  | 'PAGE_RELOADED'

/** Where a detection came from. Deterministic sources carry no confidence (§12.1). */
export type DetectionSource = 'browser' | 'system' | 'vision_model' | 'audio_model'

/** §9.1 detection models. */
export type DetectionModel =
  | 'duration_threshold'
  | 'hybrid'
  | 'instant_hard'
  | 'confidence_tiered'
  | 'rolling_window'
  | 'discrete_grace_window'
  | 'informational'

export interface SeverityTransition {
  severity: Severity
  /** Session-relative milliseconds. */
  at_ms: number
}

/**
 * §9.3 - one record per continuous condition, with severity transitioning in
 * place. A second signal is never created for the same continuous condition.
 */
export interface Signal {
  signal_id: string
  session_token: string
  signal_type: SignalType
  category: SignalCategory
  severity: Severity
  severity_history: SeverityTransition[]
  start_ms: number
  end_ms: number | null
  start_wall: string
  /** null for deterministic browser/system signals (§12.1). */
  confidence: number | null
  model_version: string | null
  candidate_visible: boolean
  detection_source: DetectionSource
  raw_event_ids: string[]
}

// ---------------------------------------------------------------------------
// §11 Raw event model - STARTED / CONTINUED / ENDED, or a discrete one-shot
// ---------------------------------------------------------------------------

export type EventPhase = 'started' | 'continued' | 'ended' | 'discrete'

export interface RawEvent {
  event_id: string
  session_token: string
  /** e.g. FULLSCREEN_EXITED_STARTED */
  event_type: string
  signal_type: SignalType
  phase: EventPhase
  /** Session-relative milliseconds - monotonic, immune to wall-clock changes. */
  ts_session_ms: number
  ts_wall: string
  detection_source: DetectionSource
  payload?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Candidate-facing recovery prompts (§8.2)
// ---------------------------------------------------------------------------

/**
 * The only four conditions a candidate is ever told about mid-session. Every
 * other signal - behavioural, identity, audio, system-side - is silent.
 */
export interface RecoveryPrompt {
  signal_type: SignalType
  title: string
  message: string
  action: string
}
