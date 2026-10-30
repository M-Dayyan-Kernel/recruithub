/**
 * What an audit row means, in words a person understands.
 *
 * The audit log stores how things changed in the database: a field name, a before and
 * after value, sometimes a bare id. This turns a row into what the Activity table shows:
 * an event name, what it applies to, a change, and a details panel. One place, so the
 * wording does not drift between pages, and so it can be tested with the shapes the
 * backend really writes.
 *
 * Rules the rest of the UI relies on:
 *  - An id is never shown in a row. A UUID-shaped value is a reference: it goes to the
 *    technical line of the details panel, nowhere else.
 *  - A value is shown through one vocabulary (In review / Shortlisted / Rejected, On / Off,
 *    a readable date), not whatever string happened to be stored.
 *  - An action this file has not heard of still reads as a sentence and never as JSON.
 *
 * Dependency-free apart from stageLabels, so `node --test` can load it.
 */

import { PHONE_SCREENING_LABEL, REJECTED_FROM_LABEL, RESUME_SCREENING_LABEL } from './stageLabels.ts'

export type ChipTone = 'muted' | 'plain' | 'accent' | 'pos' | 'warn' | 'neg'

export interface Chip {
  text: string
  tone: ChipTone
  /** The full text, when `text` is shortened to fit. */
  title?: string
}

/** The kinds of activity the type filter offers: the part of the action name before the dot. */
export const ACTIVITY_CATEGORIES = [
  { value: 'candidate', label: 'Candidate' },
  { value: 'job', label: 'Job' },
  { value: 'screening', label: 'Screening' },
  { value: 'shortlist', label: 'Shortlist' },
  { value: 'interview', label: 'Interview' },
  { value: 'user', label: 'Team' },
  { value: 'settings', label: 'Settings' },
] as const

export interface ActivityRowInput {
  action: string
  entity_type: string
  entity_id?: string | null
  feature: string
  subject_label: string
  job_id?: string | null
  candidate_id?: string | null
  before_state?: Record<string, unknown> | null
  after_state?: Record<string, unknown> | null
}

export type ActivityChange =
  | { kind: 'transition'; from: Chip; to: Chip }
  | { kind: 'chip'; chip: Chip }
  | { kind: 'text'; text: string }
  | null

export interface ActivityView {
  /** Short name of what happened, e.g. "Interview rescheduled". */
  event: string
  /** What the row is about, and what kind of thing that is (shown beneath the name). */
  subject: string
  kind: string
  /** In-app route for the subject, when one can be worked out from the row. */
  link: string | null
  change: ActivityChange
  /** Label and value pairs for the details panel. Never contains an id. */
  details: Array<[string, string]>
  note: string
  /** The one place references (ids, event codes) appear. */
  tech: string
}

// ── vocabulary ───────────────────────────────────────────────────────────────

const SHORTLIST_DECISIONS: Record<string, string> = {
  pending: 'In review',
  approved: 'Shortlisted',
  rejected: 'Rejected',
  overridden: 'Overridden',
}
const INTERVIEW_DECISIONS: Record<string, string> = {
  pending: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  overridden: 'Overridden',
}
const PIPELINE: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
}
const INTERVIEW_STATUS: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  expired: 'Expired',
}
const JOB_STATUS: Record<string, string> = {
  open: 'Open',
  active: 'Open',
  paused: 'Paused',
  closed: 'Closed',
  draft: 'Draft',
}
const ROLES: Record<string, string> = { admin: 'Admin', hr: 'HR', superadmin: 'Platform admin' }
const FEEDBACK: Record<string, string> = {
  correctly_shortlisted: 'Correctly shortlisted',
  incorrectly_shortlisted: 'Incorrectly shortlisted',
}
const MODES: Record<string, string> = { shadow: 'Shadow', enforce: 'Enforce' }
const WORK_MODES: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' }

/** What a field is called, for "<Field> changed". */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  full_name: 'Name',
  email: 'Email',
  phone: 'Phone',
  title: 'Title',
  status: 'Status',
  description: 'Description',
  required_skills: 'Skills',
  experience_min: 'Minimum experience',
  experience_max: 'Maximum experience',
  years_experience: 'Years of experience',
  work_mode: 'Work mode',
  work_location: 'Work location',
  current_ctc: 'Current CTC',
  expected_ctc: 'Expected CTC',
  notice_period: 'Notice period',
  last_working_day: 'Last working day',
  screening_questions: 'Screening questions',
  interview_questions: 'Interview questions',
  screening_call_from: 'Call window start',
  screening_call_to: 'Call window end',
  screening_timezone: 'Timezone',
  voice_screening_enabled: 'Voice screening',
  extension_check_enabled: 'Extension check',
  extension_check_mode: 'Extension check mode',
  default_enabled: 'Check new jobs by default',
  default_mode: 'Default extension mode',
  heuristics_enabled: 'Look-alike detection',
  screening_enabled: 'Phone screening',
  enforce_phone_geography: 'Phone geography',
  allowed_phone_regions: 'Phone regions',
  screening_max_retries: 'Maximum call attempts',
  screening_retry_delay_seconds: 'Delay between attempts',
  role: 'Role',
  is_active: 'Access',
  password: 'Password',
  hr_feedback_type: 'Feedback',
  hr_comments: 'Comment',
  pipeline_status: 'Processing status',
  hr_decision: 'Decision',
}

const KINDS: Record<string, string> = {
  candidate: 'Candidate',
  job: 'Job',
  shortlist: 'Shortlist',
  screening: 'Screening',
  interview: 'Interview',
  user: 'Team member',
  invite: 'Invite',
  settings: 'Settings',
  tenant: 'Organization',
  extension_policy: 'Detection mode',
  extension_blocklist: 'Blocklist',
}

// ── small helpers ────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v.trim())

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function sentenceCase(text: string): string {
  const t = text.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t
}

/** "interview_questions" -> "Interview questions". */
export function humanize(key: string): string {
  const t = key.replace(/[._]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : key
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanize(field)
}

function titleCase(text: string): string {
  return text.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Stored text as shown: never an id, never an object, with a fallback when there is nothing usable. */
function text(value: unknown, fallback: string): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.trim() !== '' && !isUuid(value)) return value
  return fallback
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function chip(text: string, tone: ChipTone = 'plain', max = 22): Chip {
  const full = text
  return text.length > max ? { text: truncate(text, max), tone, title: full } : { text, tone }
}

function decisionTone(label: string): ChipTone {
  if (label === 'In review') return 'warn'
  if (label === 'Shortlisted' || label === 'Approved') return 'pos'
  if (label === 'Rejected') return 'neg'
  return 'muted'
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A stored value as people read it, or `null` when it should not be shown at all (an id).
 * `field` selects the vocabulary; anything unrecognised is shown plainly.
 */
export function formatValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return '—'
  if (isUuid(value)) return null

  if (typeof value === 'boolean') {
    if (field.endsWith('_enabled') || field === 'enforce_phone_geography') return value ? 'On' : 'Off'
    if (field === 'is_active') return value ? 'Active' : 'Deactivated'
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    if (field === 'screening_retry_delay_seconds') {
      const m = Math.round(value / 60)
      return plural(m, 'minute')
    }
    return String(value)
  }
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return formatDateTime(value)
    const lower = value.toLowerCase()
    switch (field) {
      case 'status':
        return JOB_STATUS[lower] ?? INTERVIEW_STATUS[lower] ?? PIPELINE[lower] ?? titleCase(value)
      case 'pipeline_status':
        return PIPELINE[lower] ?? titleCase(value)
      case 'role':
        return ROLES[lower] ?? titleCase(value)
      case 'hr_feedback_type':
        return FEEDBACK[lower] ?? titleCase(value)
      case 'mode':
      case 'extension_check_mode':
      case 'default_mode':
        return MODES[lower] ?? titleCase(value)
      case 'work_mode':
        return WORK_MODES[lower] ?? titleCase(value)
      case 'result':
        return titleCase(value)
      default:
        return value
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (field === 'interview_questions' || field === 'screening_questions') {
      return plural(value.length, 'question')
    }
    // A list of references or of objects is a count, not a readout.
    if (value.some((v) => typeof v === 'object' || isUuid(v))) return plural(value.length, 'item')
    return value.map((v) => String(v)).join(', ')
  }
  if (typeof value === 'object') {
    // Never dump an object into a cell; the details panel names the fields instead.
    return `${Object.keys(value as object).length} fields`
  }
  return String(value)
}

/** Whether a row's change is a list edit we can only summarise (the stored value is the whole list). */
const LIST_FIELDS = new Set(['interview_questions', 'screening_questions'])

function categoryOf(action: string): string {
  return action.includes('.') ? action.slice(0, action.indexOf('.')) : action
}

function linkFor(row: ActivityRowInput): string | null {
  if (row.entity_type === 'job') {
    const id = row.job_id ?? row.entity_id
    return id && isUuid(id) ? `/jobs/${id}` : null
  }
  const candidate = row.candidate_id ?? (row.entity_type === 'candidate' ? row.entity_id : null)
  if (candidate && isUuid(candidate)) return `/candidates/${candidate}`
  return null
}

function techLine(row: ActivityRowInput, extra?: string): string {
  const parts = [`Event: ${row.action}`]
  if (row.feature && !['job', 'resume', 'candidate', 'platform'].includes(row.feature)) parts.push(`Field: ${row.feature}`)
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

function transition(from: string, to: string, tone: (label: string) => ChipTone, max = 22): ActivityChange {
  return { kind: 'transition', from: chip(from, tone(from), max), to: chip(to, tone(to), max) }
}

// ── the translation ──────────────────────────────────────────────────────────

/**
 * One row, as the table shows it. Total: never throws, and an unknown action degrades to a
 * plain sentence.
 */
export function describeActivity(row: ActivityRowInput): ActivityView {
  const before = row.before_state ?? null
  const after = row.after_state ?? null
  const kind = KINDS[row.entity_type] ?? humanize(row.entity_type || 'item')
  const subject = text(row.subject_label?.trim(), '—')
  const link = linkFor(row)

  const base = {
    subject,
    kind,
    link,
    change: null as ActivityChange,
    details: [] as Array<[string, string]>,
    note: '',
    tech: techLine(row),
  }
  const who: [string, string] = [kind, subject]

  switch (row.action) {
    // ── candidates ──
    case 'candidate.uploaded': {
      const file = text(after?.original_filename, subject)
      return { ...base, event: 'Resume uploaded', change: { kind: 'chip', chip: chip('New resume', 'muted') }, details: [['File', file]] }
    }
    case 'candidate.deleted':
      return { ...base, event: 'Candidate deleted', change: { kind: 'chip', chip: chip('Deleted', 'neg') }, details: [who] }
    case 'candidate.retry_processing':
    case 'candidate.retry_parse': {
      const from = formatValue('pipeline_status', before?.pipeline_status)
      const to = formatValue('pipeline_status', after?.pipeline_status)
      return {
        ...base,
        event: 'Resume processing retried',
        change: from && to && from !== '—' ? transition(from, to, () => 'plain') : { kind: 'chip', chip: chip(to ?? 'Queued', 'plain') },
        details: [who, ['Status', to ?? '—']],
      }
    }
    case 'candidate.view_detail':
      return { ...base, event: 'Profile viewed', change: { kind: 'chip', chip: chip('Viewed', 'muted') }, details: [who], note: 'Recorded because a candidate profile contains personal data.' }
    case 'candidate.gdpr_erase':
      return { ...base, event: 'Personal data erased', change: { kind: 'chip', chip: chip('Erased', 'neg') }, details: [who] }

    // ── jobs ──
    case 'job.created': {
      const status = formatValue('status', after?.status) ?? 'Open'
      return { ...base, event: 'Job created', change: { kind: 'chip', chip: chip(status, 'plain') }, details: [['Job', subject], ['Status', status]] }
    }
    case 'job.deleted':
      return { ...base, event: 'Job deleted', change: { kind: 'chip', chip: chip('Deleted', 'neg') }, details: [['Job', subject]] }

    // ── screening / shortlist runs ──
    case 'screening.triggered': {
      const started = typeof after?.initiated === 'number' ? after.initiated : typeof after?.candidate_count === 'number' ? after.candidate_count : null
      const queued = typeof after?.queued === 'number' ? after.queued : null
      const details: Array<[string, string]> = [['Job', subject]]
      if (started !== null) details.push(['Calls started', String(started)])
      if (queued !== null) details.push(['Waiting in queue', String(queued)])
      return {
        ...base,
        event: `${sentenceCase(PHONE_SCREENING_LABEL)} started`,
        change: started !== null ? { kind: 'chip', chip: chip(plural(started, 'candidate'), 'muted') } : null,
        details,
      }
    }
    case 'screening.advanced_without_call': {
      const details: Array<[string, string]> = [who, ['Reason', text(after?.reason, '—')]]
      return {
        ...base,
        event: 'Moved to interview without a call',
        change: { kind: 'chip', chip: chip('Skipped the call', 'muted') },
        details,
      }
    }
    case 'screening.rejected':
      return {
        ...base,
        event: 'Rejected in Phone screening',
        change: transition(SHORTLIST_DECISIONS.approved ?? 'Approved', SHORTLIST_DECISIONS.rejected ?? 'Rejected', decisionTone),
        details: [who, ['What happened', 'Rejected from the phone round. Any call still queued was cancelled.']],
      }
    case 'shortlist.rejected': {
      const from = REJECTED_FROM_LABEL[String(after?.rejected_from ?? '')] ?? 'the pipeline'
      return {
        ...base,
        event: `Rejected from ${from}`,
        change: { kind: 'chip', chip: chip('Rejected', 'neg') },
        details: [who, ['From', from], ['Emailed', 'Not yet. It is sent from the Rejected list.']],
      }
    }
    case 'shortlist.reconsidered': {
      const from = REJECTED_FROM_LABEL[String(before?.rejected_from ?? '')] ?? 'the pipeline'
      return {
        ...base,
        event: 'Rejection reconsidered',
        change: { kind: 'chip', chip: chip('Reconsidered', 'muted') },
        details: [who, ['Back in', from]],
      }
    }
    case 'shortlist.rejection_emailed':
      return {
        ...base,
        event: 'Rejection email sent',
        change: { kind: 'chip', chip: chip('Emailed', 'muted') },
        details: [who, ['What happened', 'The candidate was told. The rejection is now final.']],
      }
    case 'screening.call_cancelled':
      return {
        ...base,
        event: 'Screening call cancelled',
        change: { kind: 'chip', chip: chip('Cancelled', 'muted') },
        details: [who, ['What happened', 'The queued call was cancelled before it was placed. The candidate stays in Phone screening.']],
      }
    case 'screening.result_set': {
      const from = formatValue('result', before?.result)
      const to = formatValue('result', after?.result)
      return {
        ...base,
        event: `${PHONE_SCREENING_LABEL} result`,
        change: from && to ? transition(from, to, () => 'plain') : null,
        details: [who, ['From', from ?? '—'], ['To', to ?? '—']],
      }
    }
    case 'shortlist.triggered': {
      const n = typeof after?.candidate_count === 'number' ? after.candidate_count : Array.isArray(after?.candidate_ids) ? (after!.candidate_ids as unknown[]).length : null
      return {
        ...base,
        event: `${RESUME_SCREENING_LABEL} started`,
        change: n !== null ? { kind: 'chip', chip: chip(plural(n, 'candidate'), 'muted') } : null,
        details: [['Job', subject]].concat(n !== null ? [['Candidates', String(n)]] : []) as Array<[string, string]>,
      }
    }

    // ── decisions ──
    case 'shortlist.decision_set':
    case 'interview.decision_set': {
      const vocab = row.action.startsWith('shortlist') ? SHORTLIST_DECISIONS : INTERVIEW_DECISIONS
      const stage = row.action.startsWith('shortlist') ? RESUME_SCREENING_LABEL : 'Interview'
      const from = vocab[String(before?.hr_decision ?? '').toLowerCase()] ?? formatValue('hr_decision', before?.hr_decision) ?? '—'
      const to = vocab[String(after?.hr_decision ?? '').toLowerCase()] ?? formatValue('hr_decision', after?.hr_decision) ?? '—'
      return {
        ...base,
        event: row.action.startsWith('shortlist') ? 'Shortlist decision' : 'Interview decision',
        change: transition(from, to, decisionTone),
        details: [who, ['Stage', stage], ['From', from], ['To', to]],
      }
    }
    case 'shortlist.returned_to_resume':
      return {
        ...base,
        event: 'Returned to Resume Screening',
        change: transition(SHORTLIST_DECISIONS.approved ?? 'Approved', SHORTLIST_DECISIONS.pending ?? 'In review', decisionTone),
        details: [who, ['Why', 'Voice screening was turned off while they waited for a call.']],
      }
    case 'shortlist.feedback_set': {
      const type = after?.hr_feedback_type !== undefined ? formatValue('hr_feedback_type', after.hr_feedback_type) : null
      const hasComment = after?.hr_comments !== undefined && after.hr_comments !== null && after.hr_comments !== ''
      const details: Array<[string, string]> = [who]
      if (type) details.push(['Feedback', type])
      if (hasComment) details.push(['Comment', text(after!.hr_comments, '—')])
      return {
        ...base,
        event: type ? 'Shortlist feedback' : 'Shortlist comment',
        change: { kind: 'chip', chip: chip(type ?? 'Comment added', type ? (type.startsWith('Correctly') ? 'pos' : 'neg') : 'muted', 26) },
        details,
      }
    }

    // ── interviews ──
    case 'interview.queued':
      return { ...base, event: 'Interview queued', change: { kind: 'chip', chip: chip('Queued', 'muted') }, details: [who] }
    case 'interview.scheduled': {
      const when = formatValue('scheduled_interview_at', after?.scheduled_interview_at) ?? '—'
      return { ...base, event: 'Interview scheduled', change: { kind: 'chip', chip: chip(when, 'plain', 30) }, details: [who, ['Date and time', when]] }
    }
    case 'interview.rescheduled': {
      // A reschedule can carry a new time or only issue a fresh link; the
      // audit row says which, so the label must not guess.
      const when = after?.scheduled_interview_at ? formatValue('scheduled_interview_at', after.scheduled_interview_at) : null
      const was = before?.scheduled_interview_at ? formatValue('scheduled_interview_at', before.scheduled_interview_at) : null
      const details: Array<[string, string]> = [who]
      if (was) details.push(['Previous time', was])
      details.push(when ? ['New time', when] : ['What happened', 'A new interview link was issued. No date or time was set.'])
      return {
        ...base,
        event: 'Interview rescheduled',
        change: when ? { kind: 'chip', chip: chip(when, 'plain', 30) } : { kind: 'chip', chip: chip('New link issued', 'muted') },
        details,
        tech: techLine(row, typeof after?.session_id === 'string' ? `Session ${after.session_id}` : undefined),
      }
    }
    case 'interview.cancelled': {
      const was = before?.scheduled_interview_at ? formatValue('scheduled_interview_at', before.scheduled_interview_at) : null
      // Whether an email was asked for. Whether it was delivered is told to HR at the time;
      // the cancellation is saved before the email is attempted.
      const requested = after?.email_requested
      const details: Array<[string, string]> = [who]
      if (was) details.push(['Was scheduled for', was])
      details.push(['Email to candidate', requested === true ? 'Requested' : 'Not requested'])
      return {
        ...base,
        event: 'Interview cancelled',
        change: { kind: 'chip', chip: chip('Cancelled', 'neg') },
        details,
        note: 'The link no longer works. The candidate stays in Interviews, and a new link or time can be set.',
        tech: techLine(row, typeof after?.session_id === 'string' ? `Session ${after.session_id}` : undefined),
      }
    }
    case 'interview.link_sent': {
      const status = formatValue('status', after?.status) ?? 'Sent'
      const details: Array<[string, string]> = [who, ['Interview', status]]
      if (after?.reason === 'voice_screening_turned_off') {
        details.push(['Why', 'Voice screening was turned off, so they moved straight to the interview.'])
        if (after.email_sent === false) details.push(['Email', 'Not delivered'])
      }
      return { ...base, event: 'Interview link sent', change: { kind: 'chip', chip: chip(status, 'muted') }, details }
    }
    case 'interview.email_resent':
      return { ...base, event: 'Interview email resent', change: { kind: 'chip', chip: chip('Resent', 'muted') }, details: [who] }
    case 'interview.retry_assessment': {
      const from = formatValue('status', before?.status)
      const to = formatValue('status', after?.status)
      return {
        ...base,
        event: 'Assessment re-run',
        change: from && to ? transition(from, to, () => 'plain') : null,
        details: [who, ['From', from ?? '—'], ['To', to ?? '—']],
      }
    }

    // ── team ──
    case 'user.created': {
      const role = formatValue('role', after?.role) ?? '—'
      const details: Array<[string, string]> = [['Email', text(after?.email, subject)], ['Role', role]]
      if (after?.full_name) details.unshift(['Name', text(after.full_name, '—')])
      return { ...base, event: 'User created', change: { kind: 'chip', chip: chip(role, 'plain') }, details }
    }
    case 'user.invited': {
      const role = formatValue('role', after?.role) ?? '—'
      return { ...base, event: 'Invite sent', change: { kind: 'chip', chip: chip(role, 'plain') }, details: [['Email', text(after?.email, subject)], ['Role', role]] }
    }
    case 'user.invite_revoked': {
      const role = formatValue('role', before?.role) ?? '—'
      return { ...base, event: 'Invite revoked', change: { kind: 'chip', chip: chip('Revoked', 'neg') }, details: [['Email', text(before?.email, subject)], ['Role', role]] }
    }
    case 'user.deleted': {
      const role = formatValue('role', before?.role) ?? '—'
      return { ...base, event: 'User removed', change: { kind: 'chip', chip: chip('Removed', 'neg') }, details: [['Email', text(before?.email, subject)], ['Role', role]] }
    }

    // ── settings ──
    case 'settings.email_template_updated':
      return { ...base, event: 'Email template edited', change: { kind: 'chip', chip: chip('Edited', 'muted') }, details: [['Settings', 'Email templates']] }
    case 'settings.email_template_restored':
      return { ...base, event: 'Email template restored', change: { kind: 'chip', chip: chip('Restored', 'muted') }, details: [['Settings', 'Email templates']], note: 'The template went back to the default wording.' }

    // ── an organization's AI extension check ──
    case 'settings.extension_policy_updated': {
      const field = row.feature ?? 'default_mode'
      const from = formatValue(field, before?.[field]) ?? '—'
      const to = formatValue(field, after?.[field]) ?? '—'
      return { ...base, event: `${fieldLabel(field)} changed`, change: transition(from, to, () => 'plain'), details: [who, ['Setting', fieldLabel(field)], ['From', from], ['To', to]] }
    }
    case 'settings.extension_blocklist_added':
      return { ...base, event: 'Blocklist entry added', change: { kind: 'chip', chip: chip('Added', 'pos') }, details: [who, ['Extension', subject]] }
    case 'settings.extension_blocklist_deleted':
      return { ...base, event: 'Blocklist entry removed', change: { kind: 'chip', chip: chip('Removed', 'neg') }, details: [who, ['Extension', subject]] }
    case 'settings.extension_blocklist_updated': {
      const from = formatValue('status', before?.status)
      const to = formatValue('status', after?.status)
      return { ...base, event: 'Blocklist entry changed', change: from && to && from !== to ? transition(from, to, () => 'plain') : { kind: 'chip', chip: chip('Edited', 'muted') }, details: [who, ['Extension', subject]] }
    }
    case 'settings.extension_defaults_restored': {
      const added = typeof after?.added === 'number' ? after.added : 0
      const reset = typeof after?.reset === 'number' ? after.reset : 0
      return { ...base, event: 'Starting blocklist restored', change: { kind: 'chip', chip: chip('Restored', 'muted') }, details: [who, ['Added back', String(added)], ['Turned back on', String(reset)]] }
    }
    case 'settings.extension_observed_dismissed':
      return { ...base, event: 'Seen extension dismissed', change: { kind: 'chip', chip: chip('Dismissed', 'muted') }, details: [who, ['Extension', subject]] }
    case 'settings.extension_observed_restored':
      return { ...base, event: 'Seen extension restored', change: { kind: 'chip', chip: chip('Restored', 'muted') }, details: [who, ['Extension', subject]] }

    // ── earlier platform-wide events (kept so old rows still read well) ──
    case 'extension_policy.updated': {
      const from = formatValue('mode', before?.mode) ?? '—'
      const to = formatValue('mode', after?.mode) ?? '—'
      return { ...base, event: 'Detection mode changed', change: transition(from, to, () => 'plain'), details: [['From', from], ['To', to]] }
    }
    case 'extension_blocklist.added':
      return { ...base, event: 'Blocklist entry added', change: { kind: 'chip', chip: chip('Added', 'pos') }, details: [['Extension', text(after?.name, subject)]] }
    case 'extension_blocklist.deleted':
      return { ...base, event: 'Blocklist entry removed', change: { kind: 'chip', chip: chip('Removed', 'neg') }, details: [['Extension', subject]] }
    case 'extension_blocklist.updated': {
      const from = formatValue('status', before?.status)
      const to = formatValue('status', after?.status)
      return { ...base, event: 'Blocklist entry changed', change: from && to && from !== to ? transition(from, to, () => 'plain') : null, details: [['Extension', text(after?.name, subject)]] }
    }
    case 'tenant.created':
      return { ...base, event: 'Organization created', change: { kind: 'chip', chip: chip('Created', 'pos') }, details: [['Organization', subject]] }
    case 'tenant.deleted':
      return { ...base, event: 'Organization deleted', change: { kind: 'chip', chip: chip('Deleted', 'neg') }, details: [['Organization', subject]] }
    case 'tenant.approved':
      return { ...base, event: 'Organization approved', change: { kind: 'chip', chip: chip('Approved', 'pos') }, details: [['Organization', subject]] }
    case 'tenant.rejected':
      return { ...base, event: 'Organization rejected', change: { kind: 'chip', chip: chip('Rejected', 'neg') }, details: [['Organization', subject]] }
  }

  // ── field edits: "<something>.updated" with one field per row ──
  if (row.action.endsWith('.updated') && row.feature) {
    const label = fieldLabel(row.feature)
    const rawBefore = before ? before[row.feature] : undefined
    const rawAfter = after ? after[row.feature] : undefined

    if (row.feature === 'password') {
      return { ...base, event: 'Password changed', change: { kind: 'chip', chip: chip('Changed', 'muted') }, details: [who], note: 'Password values are never recorded.' }
    }
    if (LIST_FIELDS.has(row.feature)) {
      return {
        ...base,
        event: `${label} edited`,
        change: { kind: 'chip', chip: chip('Edited', 'muted') },
        details: [who, ['What changed', label]],
        note: 'A line-by-line comparison of the questions is not recorded for this event yet.',
        tech: techLine(row),
      }
    }
    const from = formatValue(row.feature, rawBefore)
    const to = formatValue(row.feature, rawAfter)
    const long = (from ?? '').length > 60 || (to ?? '').length > 60 || row.feature === 'description'
    return {
      ...base,
      event: `${label} changed`,
      change: long
        ? { kind: 'chip', chip: chip('Edited', 'muted') }
        : from !== null && to !== null
          ? { kind: 'transition', from: chip(from, 'plain', 18), to: chip(to, 'accent', 20) }
          : { kind: 'chip', chip: chip('Changed', 'muted') },
      details: [who, ['Field', label], ['From', from ?? '—'], ['To', to ?? '—']],
    }
  }

  // ── anything else: a sentence, never JSON ──
  const category = categoryOf(row.action)
  const verb = row.action.includes('.') ? row.action.slice(row.action.indexOf('.') + 1) : ''
  const event = verb ? `${humanize(category)} ${verb.replace(/_/g, ' ')}` : humanize(row.action)
  const details: Array<[string, string]> = [who]
  for (const [k, v] of Object.entries(after ?? {})) {
    const shown = formatValue(k, v)
    if (shown !== null && typeof v !== 'object') details.push([fieldLabel(k), shown])
  }
  return { ...base, event, details }
}

/** Whether the platform (not the organization) did this. */
export function isPlatformActor(role: string | null | undefined): boolean {
  return role === 'superadmin'
}

// ── grouping by day ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "Yesterday · Wednesday 21 October", relative to `now`. */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  const long = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return diff === 0 ? `Today · ${long}` : diff === 1 ? `Yesterday · ${long}` : long
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
