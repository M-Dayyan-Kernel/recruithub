/**
 * §10 Signal Registry - all 20 PRD signals plus the browser observations this
 * app can make that the registry does not list.
 *
 * Every signal is declared here, including the vision/audio ones the browser
 * cannot detect: the reviewer UI and the data model need the full vocabulary,
 * and `detected_by` records which side of the line each one sits on. Signals
 * marked 'vision_model' / 'audio_model' are never emitted by this app.
 */

import type {
  DetectionModel,
  DetectionSource,
  RecoveryPrompt,
  Severity,
  SignalCategory,
  SignalType,
} from './types'

export interface SignalDefinition {
  type: SignalType
  category: SignalCategory
  model: DetectionModel
  detected_by: DetectionSource
  /** Severity the signal is created with. */
  initial_severity: Severity
  /** For hybrid / grace-window signals: escalate to Hard after this long. */
  escalate_to_hard_after_ms?: number
  /** §8.2 - is the candidate told about this in real time? */
  candidate_visible: boolean
  /** Present only for signals in the PRD's registry (§10). */
  in_prd_registry: boolean
  label: string
}

/** §9.2 - a re-trigger within this gap continues the same signal. */
export const DEDUPE_GAP_MS = 1500

/** §9.4 - vision-model floor. Recorded here for completeness; unused client-side. */
export const VISION_CONFIDENCE_FLOOR = 0.75

/** §9.4 - the three signals whose confidence selects severity directly. */
export const CONFIDENCE_TIER_SPLIT = 0.7

const D = (d: SignalDefinition): SignalDefinition => d

export const SIGNAL_REGISTRY: Record<SignalType, SignalDefinition> = {
  // ── §10.1 Identity ────────────────────────────────────────────────────────
  NO_FACE_DETECTED: D({
    type: 'NO_FACE_DETECTED',
    category: 'identity',
    model: 'instant_hard',
    detected_by: 'vision_model',
    initial_severity: 'hard',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'No face detected',
  }),
  MULTIPLE_FACES_DETECTED: D({
    type: 'MULTIPLE_FACES_DETECTED',
    category: 'identity',
    model: 'instant_hard',
    detected_by: 'vision_model',
    initial_severity: 'hard',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Multiple faces detected',
  }),
  FACE_MISMATCH: D({
    type: 'FACE_MISMATCH',
    category: 'identity',
    model: 'instant_hard',
    detected_by: 'vision_model',
    initial_severity: 'hard',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Face mismatch',
  }),
  FACE_VISIBILITY_DEGRADED: D({
    type: 'FACE_VISIBILITY_DEGRADED',
    category: 'identity',
    model: 'hybrid',
    detected_by: 'vision_model',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 15_000,
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Face visibility degraded',
  }),

  // ── §10.2 Candidate behavior ──────────────────────────────────────────────
  GAZE_AWAY: D({
    type: 'GAZE_AWAY',
    category: 'behavior',
    model: 'duration_threshold',
    detected_by: 'vision_model',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 5_000,
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Gaze away',
  }),
  SECONDARY_DEVICE_VISIBLE: D({
    type: 'SECONDARY_DEVICE_VISIBLE',
    category: 'behavior',
    model: 'instant_hard',
    detected_by: 'vision_model',
    initial_severity: 'hard',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Secondary device visible',
  }),
  SUSTAINED_READING_GAZE: D({
    type: 'SUSTAINED_READING_GAZE',
    category: 'behavior',
    model: 'confidence_tiered',
    detected_by: 'vision_model',
    initial_severity: 'soft',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Sustained reading gaze',
  }),
  REPEATED_GAZE_DEVIATIONS: D({
    type: 'REPEATED_GAZE_DEVIATIONS',
    category: 'behavior',
    model: 'rolling_window',
    detected_by: 'vision_model',
    initial_severity: 'soft',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Repeated gaze deviations',
  }),

  // ── §10.3 Screen / browser ────────────────────────────────────────────────
  SCREEN_SHARE_INTERRUPTED: D({
    type: 'SCREEN_SHARE_INTERRUPTED',
    category: 'screen_browser',
    model: 'discrete_grace_window',
    detected_by: 'browser',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 30_000,
    candidate_visible: true,
    in_prd_registry: true,
    label: 'Screen share interrupted',
  }),
  SCREEN_SHARE_RESUMED: D({
    type: 'SCREEN_SHARE_RESUMED',
    category: 'screen_browser',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Screen share resumed',
  }),
  FULLSCREEN_EXITED: D({
    type: 'FULLSCREEN_EXITED',
    category: 'screen_browser',
    model: 'discrete_grace_window',
    detected_by: 'browser',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 15_000,
    candidate_visible: true,
    in_prd_registry: true,
    label: 'Fullscreen exited',
  }),
  // PRD specifies vision analysis of the screen recording for these two. The
  // browser-event detection here is a complement, not the specified source -
  // detection_source stays 'browser' so the difference is visible downstream.
  TAB_CHANGE: D({
    type: 'TAB_CHANGE',
    category: 'screen_browser',
    model: 'duration_threshold',
    detected_by: 'browser',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 2_000,
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Tab change',
  }),
  WINDOW_CHANGE: D({
    type: 'WINDOW_CHANGE',
    category: 'screen_browser',
    model: 'discrete_grace_window',
    detected_by: 'browser',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 10_000,
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Window change',
  }),

  // ── §10.4 Device / media ──────────────────────────────────────────────────
  CAMERA_INTERRUPTED: D({
    type: 'CAMERA_INTERRUPTED',
    category: 'device_media',
    model: 'instant_hard',
    detected_by: 'browser',
    initial_severity: 'hard',
    candidate_visible: true,
    in_prd_registry: true,
    label: 'Camera interrupted',
  }),
  MICROPHONE_INTERRUPTED: D({
    type: 'MICROPHONE_INTERRUPTED',
    category: 'device_media',
    model: 'discrete_grace_window',
    detected_by: 'browser',
    initial_severity: 'soft',
    escalate_to_hard_after_ms: 30_000,
    candidate_visible: true,
    in_prd_registry: true,
    label: 'Microphone interrupted',
  }),

  // ── §10.5 Session integrity ───────────────────────────────────────────────
  NETWORK_INTERRUPTED: D({
    type: 'NETWORK_INTERRUPTED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Network interrupted',
  }),
  MONITORING_INTERRUPTED: D({
    type: 'MONITORING_INTERRUPTED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'system',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Monitoring interrupted',
  }),
  RECORDING_INTERRUPTED: D({
    type: 'RECORDING_INTERRUPTED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'system',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Recording interrupted',
  }),
  MONITORING_RESUMED: D({
    type: 'MONITORING_RESUMED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'system',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Monitoring resumed',
  }),

  // ── §10.6 Audio ───────────────────────────────────────────────────────────
  MULTIPLE_VOICES_DETECTED: D({
    type: 'MULTIPLE_VOICES_DETECTED',
    category: 'audio',
    model: 'confidence_tiered',
    detected_by: 'audio_model',
    initial_severity: 'soft',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Multiple voices detected',
  }),
  PROLONGED_SILENCE: D({
    type: 'PROLONGED_SILENCE',
    category: 'audio',
    model: 'duration_threshold',
    detected_by: 'audio_model',
    initial_severity: 'soft',
    candidate_visible: false,
    in_prd_registry: true,
    label: 'Prolonged silence',
  }),

  // ── Out-of-registry browser observations ──────────────────────────────────
  // Not in the PRD's 20. Kept as Informational so they never influence severity
  // handling, stay invisible to the candidate, and are simple to drop if Product
  // decides against them.
  CLIPBOARD_USE: D({
    type: 'CLIPBOARD_USE',
    category: 'screen_browser',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Clipboard use',
  }),
  DEVTOOLS_OPENED: D({
    type: 'DEVTOOLS_OPENED',
    category: 'screen_browser',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Developer tools opened',
  }),
  MULTIPLE_DISPLAYS: D({
    type: 'MULTIPLE_DISPLAYS',
    category: 'screen_browser',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Multiple displays attached',
  }),
  VIRTUAL_CAMERA_PRESENT: D({
    type: 'VIRTUAL_CAMERA_PRESENT',
    category: 'device_media',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Virtual camera present',
  }),
  AUTOMATION_DETECTED: D({
    type: 'AUTOMATION_DETECTED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Browser automation detected',
  }),
  PAGE_RELOADED: D({
    type: 'PAGE_RELOADED',
    category: 'session_integrity',
    model: 'informational',
    detected_by: 'browser',
    initial_severity: 'informational',
    candidate_visible: false,
    in_prd_registry: false,
    label: 'Page reloaded',
  }),
}

/**
 * §8.2 - the complete set of candidate-facing messages. Recoverable technical
 * issues only; behavioural, identity, audio and system-side signals are silent.
 */
export const RECOVERY_PROMPTS: Record<string, RecoveryPrompt> = {
  SCREEN_SHARE_INTERRUPTED: {
    signal_type: 'SCREEN_SHARE_INTERRUPTED',
    title: 'Screen sharing has stopped',
    message:
      'Your screen sharing has stopped. Please resume screen sharing to continue your interview.',
    action: 'Resume screen sharing',
  },
  FULLSCREEN_EXITED: {
    signal_type: 'FULLSCREEN_EXITED',
    title: 'Fullscreen mode exited',
    message: 'Please return to fullscreen to continue your interview.',
    action: 'Return to fullscreen',
  },
  CAMERA_INTERRUPTED: {
    signal_type: 'CAMERA_INTERRUPTED',
    title: 'Camera interrupted',
    message:
      'Your camera has stopped. Please reconnect your camera to continue your interview.',
    action: 'Reconnect camera',
  },
  MICROPHONE_INTERRUPTED: {
    signal_type: 'MICROPHONE_INTERRUPTED',
    title: 'Microphone interrupted',
    message:
      'Your microphone has stopped. Please reconnect your microphone to continue your interview.',
    action: 'Reconnect microphone',
  },
}

export function definitionOf(type: SignalType): SignalDefinition {
  return SIGNAL_REGISTRY[type]
}
