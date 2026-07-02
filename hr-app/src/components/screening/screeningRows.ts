import type { Candidate, ScreeningCall, ShortlistResultWithCandidate, SystemSettings } from '@/types/api'
import { phoneLooksIndian } from '@/components/screening/screeningUtils'

export type ScreeningTabId = 'pending' | 'completed' | 'flagged'

export interface ScreeningRow {
  candidateId: string
  candidateName: string
  phone: string | null
  shortlist: ShortlistResultWithCandidate
  latestCall: ScreeningCall | null
  attemptNumber: number
  tab: ScreeningTabId
  statusLabel: string
  canCallNow: boolean
  isActive: boolean
  isScheduledRetry: boolean
  flagReason?: string
}

const LIVE_CALL_STATUSES = new Set(['initiated', 'in_progress'])

function isScheduledRetry(call: ScreeningCall): boolean {
  return call.call_status === 'pending' && !call.vapi_call_id
}

function isLiveCall(call: ScreeningCall): boolean {
  return LIVE_CALL_STATUSES.has(call.call_status)
}

function latestCallForCandidate(
  candidateId: string,
  calls: ScreeningCall[],
): ScreeningCall | null {
  const forCandidate = calls.filter((c) => c.candidate_id === candidateId)
  if (forCandidate.length === 0) return null
  return [...forCandidate].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0]
}

function isConfigFailure(call: ScreeningCall): boolean {
  const reason = `${call.ended_reason ?? ''} ${call.summary ?? ''}`.toLowerCase()
  return (
    reason.includes('error-get-transport') ||
    reason.includes('error-get-resources-validation') ||
    reason.includes('vapi api error 401') ||
    reason.includes('vapi api error 403') ||
    reason.includes('api key')
  )
}

function technicalFailureReason(call: ScreeningCall): string {
  if (call.summary) return call.summary
  if (call.ended_reason) {
    return `Call failed before connecting (${call.ended_reason}). Check Vapi/Twilio configuration.`
  }
  return 'Call could not connect (technical failure). Check Vapi phone number and Twilio settings.'
}

function isConnectFailure(call: ScreeningCall): boolean {
  return (
    call.call_outcome === 'no_answer' ||
    call.call_outcome === 'voicemail' ||
    call.call_outcome === 'dropped'
  )
}

function isTechnicalFailure(call: ScreeningCall): boolean {
  return call.call_status === 'failed' || call.call_outcome === 'failed'
}

function maxDialAttempts(settings: SystemSettings | undefined): number {
  return settings?.screening_max_retries ?? 3
}

function dialAttemptsExhausted(call: ScreeningCall, maxAttempts: number): boolean {
  return (call.retry_count ?? 0) >= maxAttempts - 1
}

function classifyTab(
  call: ScreeningCall | null,
  phone: string | null,
  settings: SystemSettings | undefined,
): { tab: ScreeningTabId; flagReason?: string } {
  if (!phone) {
    return { tab: 'flagged', flagReason: 'No phone number on file' }
  }

  if (settings?.enforce_phone_geography && settings.allowed_phone_regions.includes('IN')) {
    if (!phoneLooksIndian(phone)) {
      return { tab: 'flagged', flagReason: 'Phone number not in allowed region (+91 only)' }
    }
  }

  if (!call) {
    return { tab: 'pending' }
  }

  if (call.call_outcome === 'declined') {
    return { tab: 'flagged', flagReason: 'Candidate declined the call' }
  }

  if (isTechnicalFailure(call)) {
    return { tab: 'flagged', flagReason: technicalFailureReason(call) }
  }

  const maxAttempts = maxDialAttempts(settings)

  if (isLiveCall(call) || isScheduledRetry(call) || call.call_status === 'pending') {
    return { tab: 'pending' }
  }

  if (isConnectFailure(call)) {
    if (dialAttemptsExhausted(call, maxAttempts)) {
      return { tab: 'flagged', flagReason: 'Unable to connect after maximum attempts' }
    }
    return { tab: 'pending' }
  }

  if (call.call_status === 'completed' && call.result === 'needs_review') {
    return { tab: 'flagged', flagReason: 'Screening result needs HR review' }
  }

  if (
    call.call_status === 'completed' &&
    (call.call_outcome === 'completed' || call.result === 'pass' || call.result === 'fail')
  ) {
    return { tab: 'completed' }
  }

  return { tab: 'pending' }
}

function isCallablePhone(phone: string | null, settings: SystemSettings | undefined): boolean {
  if (!phone) return false
  if (settings?.enforce_phone_geography && settings.allowed_phone_regions.includes('IN')) {
    return phoneLooksIndian(phone)
  }
  return true
}

function isManualCallBlocked(call: ScreeningCall | null): boolean {
  if (!call) return false
  return isTechnicalFailure(call) && isConfigFailure(call)
}

function canCallNowForRow(
  tab: ScreeningTabId,
  phone: string | null,
  latestCall: ScreeningCall | null,
  settings: SystemSettings | undefined,
): boolean {
  if (tab === 'completed') return false
  if (!isCallablePhone(phone, settings)) return false
  if (latestCall && isLiveCall(latestCall)) return false
  if (tab !== 'flagged' && isManualCallBlocked(latestCall)) return false

  const scheduledRetry = latestCall ? isScheduledRetry(latestCall) : false
  const maxAttempts = maxDialAttempts(settings)

  if (tab === 'pending') {
    return (
      latestCall === null ||
      scheduledRetry ||
      (latestCall !== null &&
        isConnectFailure(latestCall) &&
        !dialAttemptsExhausted(latestCall, maxAttempts))
    )
  }

  if (tab === 'flagged') {
    return true
  }

  return false
}

function statusLabelForRow(
  call: ScreeningCall | null,
  tab: ScreeningTabId,
  flagReason?: string,
): string {
  if (!call) return 'Pending'

  if (tab === 'flagged') {
    if (flagReason?.toLowerCase().includes('maximum attempts')) {
      return 'Max Attempts Reached'
    }
    if (isConnectFailure(call)) return 'Unable to Connect'
    if (flagReason?.toLowerCase().includes('needs hr review')) return 'Needs Review'
    return 'Flagged'
  }

  if (isLiveCall(call)) {
    return 'Call In Progress'
  }

  if (isScheduledRetry(call)) {
    if ((call.retry_count ?? 0) > 0) return 'Retry Scheduled'
    return 'Queued'
  }

  if (call.call_status === 'pending') return 'Queued'

  if (call.call_outcome === 'no_answer' || call.call_outcome === 'failed') {
    return 'Unable to Connect'
  }
  if (call.call_outcome === 'voicemail') return 'Voicemail'
  if (call.call_outcome === 'dropped') return 'Call Dropped'
  if (call.call_outcome === 'completed' || call.call_status === 'completed') {
    return 'Completed'
  }

  return 'Pending'
}

export function buildScreeningRows(
  approvedShortlist: ShortlistResultWithCandidate[],
  candidatesMap: Record<string, Candidate>,
  screeningCalls: ScreeningCall[],
  settings: SystemSettings | undefined,
): ScreeningRow[] {
  return approvedShortlist.map((sr) => {
    const candidate = candidatesMap[sr.candidate_id]
    const phone = candidate?.phone ?? null
    const name =
      sr.candidate_name ??
      candidate?.parsed_data?.name ??
      candidate?.name ??
      'Candidate'
    const latestCall = latestCallForCandidate(sr.candidate_id, screeningCalls)
    const { tab, flagReason } = classifyTab(latestCall, phone, settings)
    const attemptNumber = latestCall ? (latestCall.retry_count ?? 0) + 1 : 1
    const scheduledRetry = latestCall ? isScheduledRetry(latestCall) : false
    const isActive = latestCall ? isLiveCall(latestCall) : false
    const canCallNow = canCallNowForRow(tab, phone, latestCall, settings)

    return {
      candidateId: sr.candidate_id,
      candidateName: name,
      phone,
      shortlist: sr,
      latestCall,
      attemptNumber,
      tab,
      statusLabel: statusLabelForRow(latestCall, tab, flagReason),
      canCallNow,
      isActive,
      isScheduledRetry: scheduledRetry,
      flagReason,
    }
  })
}

export function countByTab(rows: ScreeningRow[]): Record<ScreeningTabId, number> {
  return {
    pending: rows.filter((r) => r.tab === 'pending').length,
    completed: rows.filter((r) => r.tab === 'completed').length,
    flagged: rows.filter((r) => r.tab === 'flagged').length,
  }
}
