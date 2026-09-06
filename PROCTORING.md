# Proctoring - candidate app (frontend)

Implements the candidate-facing half of **ScaleHR AI Proctoring PRD v1.0**.
Frontend only: no backend changes, no AI. The interview API is untouched - see
`API-CONTRACT-AI-INTERVIEWS.md`.

## TODO: not possible until the API exists

Everything below is unbuilt because there is no proctoring backend. The client
detects and enforces in the browser; nothing leaves it. Each item names what
unblocks it, specified under [Endpoints to build](#endpoints-to-build).

**Nothing is stored**

- [ ] Signals and raw events live in the tab and are lost when it closes. They
      are batched into an outbox in the shape the API will take, and go nowhere.
      *Needs `POST .../proctor/events`.*
- [ ] HR sees no violation list, no severities, no timeline. The only visible
      trace of a problem is an interview that ended early with a short
      transcript. *Needs `POST .../proctor/events` plus the Phase 3 reviewer routes.*
- [ ] Precondition attempts, consent records and the baseline photo are held in
      `sessionStorage` and never persisted, so there is no audit trail of who
      agreed to what, or of a candidate who failed a gate twelve times.
      *Needs `.../proctor/precondition`, `.../proctor/consent`, `.../proctor/baseline`.*

**The gate is not actually enforced**

- [ ] The §7.2 hard gate is client-side only. A candidate who edits the client,
      or calls `POST /api/interview/{token}/start` directly, joins the room with
      no consent, no screen share and no baseline. This is exactly the
      client-side inference REQ-STATE-01/02 forbids. *Needs `.../proctor/activate`
      plus a check inside `/start`.*
- [ ] Policy values (one warning, which signals are enforced, fullscreen
      required) are compiled into the bundle, so they cannot be changed per
      tenant or without a redeploy. *Needs the `proctoring` block on
      `GET /api/interview/{token}`.*

**No evidence**

- [ ] The screen share is watched for interruptions but never recorded or
      uploaded. Only LiveKit's existing camera and audio egress is kept.
      *Needs `.../proctor/recording/chunk` and `/finalize`.*
- [ ] No retention lifecycle: no 90-day active window, no archive, no restore,
      no deletion. *Needs the recording routes plus a storage tier.*
- [ ] No signal-to-video navigation, so no clicking a signal to seek to its
      moment, and no 5s pre-roll and post-roll. There is no video to seek.
      *Needs `GET /api/proctoring/signals/{id}/evidence`.*
- [ ] Recording gaps cannot be rendered on a timeline, because there is no
      timeline.

**No AI, so 11 of the 20 registry signals never fire**

- [ ] Identity: `NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`, `FACE_MISMATCH`,
      `FACE_VISIBILITY_DEGRADED`. The baseline photo is captured and accepted
      without any face check, so identity is unverified.
- [ ] Behaviour: `GAZE_AWAY`, `SUSTAINED_READING_GAZE`,
      `REPEATED_GAZE_DEVIATIONS`, `SECONDARY_DEVICE_VISIBLE`. A phone beside the
      laptop, or eyes on a second screen, is invisible.
- [ ] Audio: `MULTIPLE_VOICES_DETECTED`, `PROLONGED_SILENCE`. Someone feeding
      answers out of frame is undetectable.
- [ ] `TAB_CHANGE` and `WINDOW_CHANGE` come from browser focus events, not from
      vision analysis of the screen recording as §10.3 specifies, so they report
      that focus moved, not what appeared on screen.

**No reviewer workflow**

- [ ] No signal list, severity and category filters, or evidence-type badges.
- [ ] No AI recommendation and no weighted risk score (§12.2).
- [ ] No decision capture: Flagged, Clear, Needs Further Review.
- [ ] No per-signal or overall reviewer notes, and no edit or retract history.
- [ ] No evidence-access logging and no org-level isolation checks, since there
      is nothing to access.

**Backend-side signals that can never fire from a browser**

- [ ] `MONITORING_INTERRUPTED`, `RECORDING_INTERRUPTED`, `MONITORING_RESUMED`.
      They are declared in the registry so the vocabulary is complete, and only
      the server can raise them.

## Enforcement: a deliberate departure from the PRD

The PRD keeps every behavioural signal silent and never ends a session (§8.2,
§17). This build does not, by product decision:

**Leaving the interview screen warns the candidate once, and ends the interview
the next time.** That covers tab switches (`TAB_CHANGE`) and switching to
another window or application (`WINDOW_CHANGE`).

It is confined to one file, `src/proctoring/policy.ts`. `ENFORCEMENT.enabled =
false` restores the PRD model exactly; `maxWarnings` and the `enforced` list are
the other two knobs. No other signal can end a session, and nothing else about
detection, severity or the recovery prompts changed.

Everything else still follows the PRD:

1. **Gates never end a session** (§7.3, REQ-STATE-05). A failed precondition
   blocks progression and can be retried without limit.
2. **Identity, audio and system-side signals stay silent** (§8.2). The only
   other mid-session messages are the four recovery prompts: screen share
   stopped, fullscreen exited, camera interrupted, microphone interrupted.
3. **State, event and signal stay separate objects** (§7, §9, §11). Raw events
   are append-only and are never rewritten when a signal deduplicates or
   escalates.

## Layout

| File | Role |
|---|---|
| `src/proctoring/types.ts` | PRD vocabulary - states, preconditions, severities, categories, event/signal records |
| `src/proctoring/registry.ts` | All 20 registry signals + 6 out-of-registry browser observations, with thresholds and candidate visibility |
| `src/proctoring/engine.ts` | Raw-event log and signal classification: dedup, in-place escalation, severity history |
| `src/proctoring/session.ts` | Per-token session: state machine, precondition records, attempt log, media streams |
| `src/proctoring/browser.ts` | Capability probes, permissions, fullscreen, frame capture |
| `src/proctoring/detectors.ts` | Live detectors that feed the engine during PROCTORING_ACTIVE |
| `src/proctoring/transport.ts` | Append-only batching outbox (see *Backend seam*) |
| `src/components/preflight/` | The seven gate screens and their orchestrator |
| `src/components/GradientShell.tsx` | Light card on gradient surface shared by every screen outside the room |
| `src/components/AiOrb.tsx` | The AI interviewer's animated presence (idle, speaking, connecting) |
| `src/components/RecoveryPrompt.tsx` | The four candidate-visible prompts |

## Pre-flight sequence (§8)

Consent to System check to Permissions to Screen share to Environment to Fullscreen to
Baseline photo. Each gate records a pass/fail attempt on the session; the
candidate cannot reach the room until all mandatory preconditions have a
recorded pass (§7.2). The step shown is derived from the records, so a reload
resumes in place, and a gate that is later invalidated - leaving fullscreen, a
screen-share stream dying - pulls the candidate back to it.

Notes on individual gates:

- **Consent** lists all eight things being consented to; declining keeps the
  candidate on the step with a retry message and never ends anything.
- **System check** treats *capability exists*, *permission granted* and *stream
  active* as distinct. A browser without visibility-API tab detection is
  reported as unsupported, per the PRD's derivation rule.
- **Screen share** validates the returned track's `displaySurface` and rejects a
  tab or window pick - the browser cannot force a whole-screen choice.
- **Environment** is instructional only, never validated, exactly as specified.
- **Baseline** captures a frame and accepts it. Face validation is a vision
  model and is out of scope for this build.

## Signals implemented

Browser-detectable, with PRD thresholds:

| Signal | Behaviour |
|---|---|
| `SCREEN_SHARE_INTERRUPTED` | Soft to Hard at 30s · candidate prompt |
| `SCREEN_SHARE_RESUMED` | Informational recovery marker |
| `FULLSCREEN_EXITED` | Soft to Hard at 15s · candidate prompt |
| `CAMERA_INTERRUPTED` | Instant Hard · candidate prompt |
| `MICROPHONE_INTERRUPTED` | Soft to Hard at 30s · candidate prompt |
| `TAB_CHANGE` | Soft to Hard at 2s · **warns, then ends the interview** |
| `WINDOW_CHANGE` | Soft to Hard at 10s · **warns, then ends the interview** |
| `NETWORK_INTERRUPTED` | Informational · silent |

The 11 vision/audio signals (identity, gaze, secondary device, voices, silence)
and the three backend/infra signals are declared in the registry so the data
model and any reviewer UI have the full vocabulary, but this app never emits
them.

**Deviation to note:** the PRD specifies Tab Change and Window Change come from
*vision analysis of the screen recording*, not browser focus events. What is
implemented is browser-event detection, and `detection_source: 'browser'`
records that, so it is distinguishable downstream and can be superseded.

Out of registry, kept as **Informational** and invisible to the candidate:
clipboard use (also blocked - a voice interview has no text entry), devtools
opened, multiple displays, virtual camera present, browser automation, page
reload. Dropping them means deleting their entries from `registry.ts` and their
detectors.

## Backend seam

`transport.ts` batches events, signals, preconditions and attempts in the shape
the ingest API will take, mirrors them to sessionStorage, and drains through a
`sink`. There is no proctoring endpoint yet, so the default sink retains
batches. When the backend lands, call `setProctorSink(...)` - nothing that
produces events changes.

Two PRD requirements cannot be met by a frontend and are open until then:

- **REQ-STATE-01/02** - the hard gate must be enforced server-side and the room
  must not render until the *backend* confirms `PROCTORING_ACTIVE`. Today the
  gate check in `session.canEnterActive()` is the only enforcement.
- **Recording** - camera and screen recording, MP4/H.264/AAC, the retention
  lifecycle and evidence references are all server-side.

The API needed to close both is specified below.

## Endpoints to build

Nothing in this section exists yet. The candidate app calls only the three
documented public routes (`GET /api/interview/{token}`, `POST .../start`,
`POST .../complete`) and no others.

Conventions follow `API-CONTRACT-AI-INTERVIEWS.md`: `/api` prefix, UUID v4 ids,
ISO-8601 UTC timestamps, `{ "detail": "..." }` on errors, cross-tenant ids
return 404 rather than 403. Candidate routes authenticate with the unguessable
`unique_token` in the path and must never carry an HR JWT. Reviewer routes take
the HR bearer token.

### Phase 1 - makes the current frontend real

#### `GET /api/interview/{token}/proctor/state`

Server view of the proctoring session, so the client can resume after a reload
and can gate the room on the server's answer rather than its own (REQ-STATE-02).

**Response `200`**

```ts
interface ProctorStateResponse {
  session_id: string;
  state: "SESSION_VALIDATED" | "CONSENT_PENDING" | "SYSTEM_CHECK"
       | "PERMISSION_ACQUISITION" | "SCREEN_SHARE_VALIDATION"
       | "ENVIRONMENT_PREPARATION" | "FULLSCREEN_VALIDATION"
       | "BASELINE_FACE_CAPTURE" | "BASELINE_ESTABLISHED"
       | "PROCTORING_ACTIVE" | "SESSION_COMPLETION" | "INCOMPLETE";
  preconditions: {
    type: "consent" | "system_check" | "permission_camera"
        | "permission_microphone" | "permission_screen" | "permission_location"
        | "screen_share" | "environment" | "fullscreen" | "baseline";
    status: "pending" | "passed" | "failed";
    at: string | null;
    failure_reason: string | null;
  }[];
  missing: string[];          // mandatory preconditions not yet passed
  can_activate: boolean;
  policy: {                   // replaces the hard-coded values in policy.ts
    enabled: boolean;
    require_fullscreen: boolean;
    max_warnings: number;
    enforced_signals: string[];
    blur_grace_ms: number;
  };
}
```

| Status | When |
|--------|------|
| `404` | Unknown token |
| `410` | Link expired |

#### `POST /api/interview/{token}/proctor/precondition`

Records one gate outcome and its attempt. Every attempt is persisted, pass or
fail (REQ-STATE-06), and a failure is always retryable (§7.3).

**Request**

```json
{
  "type": "screen_share",
  "outcome": "failed",
  "failure_reason": "wrong surface: browser",
  "details": { "display_surface": "browser" }
}
```

**Response `200`:** the same body as `GET .../proctor/state`.

| Status | When |
|--------|------|
| `404` | Unknown token |
| `409` | Session already `PROCTORING_ACTIVE` or terminal |
| `422` | Unknown precondition type |

#### `POST /api/interview/{token}/proctor/consent`

Consent carries a version and must accept unlimited retries, so declines are
persisted too and never terminate anything.

**Request:** `{ "accepted": true, "consent_version": "1.0" }`

**Response `200`:** `{ "consent_id": "uuid", "accepted": true, "recorded_at": "..." }`

#### `POST /api/interview/{token}/proctor/baseline`

**Content-Type:** `multipart/form-data`, field `image` (JPEG, max 2 MB).

Stores the baseline frame and returns its id. v1 accepts any capture; face
validation is a vision-model concern.

**Response `201`:** `{ "baseline_id": "uuid", "status": "captured", "captured_at": "..." }`

| Status | When |
|--------|------|
| `413` | Image too large |
| `422` | Not an image |

#### `POST /api/interview/{token}/proctor/activate`

**The safety-critical endpoint.** Re-validates every mandatory precondition at
call time from persisted records, never from a cached flag or a client claim
(REQ-API-01, REQ-STATE-01). Idempotent: calling it twice on an active session
returns `200`.

**Response `200`:** `{ "state": "PROCTORING_ACTIVE", "activated_at": "..." }`

**Response `409`** when a gate is missing:

```json
{
  "detail": {
    "code": "proctoring_preconditions_unmet",
    "message": "Preconditions not satisfied",
    "missing": ["screen_share", "baseline"]
  }
}
```

`POST /api/interview/{token}/start` should then refuse to create the LiveKit
room unless the session is `PROCTORING_ACTIVE`, returning the same `409` body.
That is a behaviour change to an existing endpoint, not a new one.

#### `POST /api/interview/{token}/proctor/events`

Append-only ingest. This is the endpoint `transport.ts` is already shaped for:
set `setProctorSink()` to post this body and nothing else in the client changes.

**Request** (exactly the current `ProctorBatch`)

```ts
interface ProctorBatch {
  batch_id: string;            // client generated, dedupe key
  session_token: string;
  flushed_at: string;
  events: RawEvent[];          // append-only, may arrive out of order
  signals: Signal[];           // full snapshot, severity transitions in place
  preconditions: PreconditionRecord[];
  attempts: PreconditionAttempt[];
}

interface RawEvent {
  event_id: string;
  event_type: string;          // e.g. FULLSCREEN_EXITED_STARTED
  signal_type: string;
  phase: "started" | "continued" | "ended" | "discrete";
  ts_session_ms: number;       // monotonic, session relative
  ts_wall: string;
  detection_source: "browser" | "system" | "vision_model" | "audio_model";
  payload?: Record<string, unknown>;
}

interface Signal {
  signal_id: string;
  signal_type: string;
  category: "identity" | "behavior" | "screen_browser"
          | "device_media" | "session_integrity" | "audio";
  severity: "informational" | "soft" | "hard";
  severity_history: { severity: string; at_ms: number }[];
  start_ms: number;
  end_ms: number | null;
  start_wall: string;
  confidence: number | null;   // null for deterministic browser signals
  model_version: string | null;
  candidate_visible: boolean;
  detection_source: string;
  raw_event_ids: string[];
}
```

**Response `202`:** `{ "accepted_events": 12, "duplicate_events": 0, "accepted_signals": 3 }`

Rules:

- Idempotent on `batch_id` and on `event_id`; a retried batch is not double counted.
- Out-of-order delivery is reconciled server-side by `ts_session_ms` (REQ-API-02).
- Raw events are never mutated or deleted, including when a signal deduplicates
  or escalates (REQ-EVT-02).
- Signals upsert on `signal_id`, so an escalated signal updates in place and
  keeps its `severity_history` rather than creating a second row.
- Rate limit should be separate from, and higher than, the 20/min on
  `start`/`complete`; the client batches every 5s. 90/min per token is enough.

| Status | When |
|--------|------|
| `202` | Accepted |
| `404` | Unknown token |
| `410` | Expired link |
| `413` | Batch too large (cap at 50 events) |
| `429` | Rate limit |

### Phase 2 - evidence

#### `POST /api/interview/{token}/proctor/recording/chunk`

**Content-Type:** `multipart/form-data`. Fields: `kind` (`camera` | `screen`),
`sequence` (int), `chunk` (blob), `started_at_ms`.

Browsers produce WebM/VP9/Opus from `MediaRecorder`, so the server transcodes to
the PRD's canonical MP4/H.264/AAC. Chunks are ordered by `sequence` per `kind`.

**Response `202`:** `{ "recording_id": "uuid", "received": 41 }`

#### `POST /api/interview/{token}/proctor/recording/finalize`

Closes the recording, triggers transcode, and starts the 90-day active clock.

**Response `202`:** `{ "recording_id": "uuid", "status": "processing" }`

### Phase 3 - reviewer and AI

All HR bearer token, roles `admin` | `hr` | `superadmin`, strictly scoped to the
reviewer's own organisation on every route (REQ-SEC-02).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/candidates/{candidate_id}/proctoring` | Session summary: state, counts by severity and category, integrity indicators, recording availability |
| `GET` | `/api/proctoring/sessions/{session_id}/signals` | Signal list; query `severity`, `category`, `cursor` |
| `GET` | `/api/proctoring/signals/{signal_id}/evidence` | Resolves the evidence chain server-side and returns `recording_id`, `video_start_ms`, `video_end_ms`, `evidence_type` (REQ-NAV-01) |
| `GET` | `/api/proctoring/recordings/{recording_id}` | Short-lived presigned playback URL; logs the access as an audit event (REQ-SEC-01) |
| `POST` | `/api/proctoring/recordings/{recording_id}/restore` | Archive to active restore, resets the 90-day clock |
| `GET` | `/api/proctoring/sessions/{session_id}/recommendation` | AI recommendation, kept separate from the human decision (§16) |
| `POST` | `/api/proctoring/sessions/{session_id}/decision` | `{ status: "FLAGGED" \| "CLEAR" \| "NEEDS_FURTHER_REVIEW", note }` |
| `POST` | `/api/proctoring/signals/{signal_id}/notes` | Per-signal reviewer note |
| `PATCH` | `/api/proctoring/notes/{note_id}` | Edit, original preserved in `edit_history` (REQ-REV-03) |
| `DELETE` | `/api/proctoring/notes/{note_id}` | Retract, logged as its own audit entry |
| `GET` | `/api/proctoring/sessions/{session_id}/audit` | Full lifecycle audit trail |

Two invariants the API must hold: the AI recommendation and the human decision
are separate records that never merge (§16), and signal, event, evidence and
audit rows are never hard-deleted, so a reviewer can still see that a Hard
signal occurred after its video ages out (REQ-DATA-01).

### Extension to an existing endpoint

`GET /api/interview/{token}` should gain a `proctoring` block carrying the
policy, so thresholds stop being hard-coded in the client:

```json
{
  "proctoring": {
    "enabled": true,
    "require_fullscreen": true,
    "max_warnings": 1,
    "enforced_signals": ["TAB_CHANGE", "WINDOW_CHANGE"],
    "blur_grace_ms": 1500
  }
}
```

## Verified

Engine behaviour was exercised against the PRD's boundary table (§23.1): dedup
at the 1.5s gap in both directions, Tab Change soft at 1.9s to hard at 2.2s with
`severity_history` on one record, instant-Hard signals with no transient Soft
stage (REQ-QA-02), null confidence/model version on deterministic signals
(§12.1), and only candidate-visible signals producing prompts. The gate was
tested with the negative case for every single precondition (REQ-QA-01), plus
optional location and unlimited consent retry.

## Test data

```bash
cd backend && source .venv/bin/activate
python -m scripts.seed_proctoring_demo                 # job + links labelled "demo"
python -m scripts.seed_proctoring_demo --label round2  # a separate job + its own links
```

Each label gets its own job and its own three links:

| Token | State | Use |
|---|---|---|
| `proctor-<label>-1` | pending | full pre-flight and interview |
| `proctor-<label>-2` | pending | spare link |
| `proctor-<label>-3` | completed | "already completed" landing state |

Re-running the same label **re-arms** the pending links - status, timings and
room details are reset - so a used URL can be walked through again.

Open `http://localhost:5174/interview/proctor-demo-1`. The seed also creates the
tenant **Proctor Demo Org** and an HR login `hr@proctor-demo.example.com` /
`Demo@12345`. LiveKit credentials come from the tenant integrations with an
`.env` fallback, so the seeded tenant works without extra setup.

## Known limits

- Browser-level chords (Ctrl+T, Ctrl+W, Alt+Tab, Cmd+Tab) cannot be cancelled by
  a page; they surface as Window Change / Tab Change after the fact.
- If only one screen is shared, activity on an unshared monitor is invisible -
  an accepted v1 limitation in the PRD.
- Devtools detection is a window-size heuristic and is informational only.
- Candidate-side interference with the monitoring pipeline itself (extensions
  blocking capture, spoofed camera feeds) is explicitly out of scope for v1.
