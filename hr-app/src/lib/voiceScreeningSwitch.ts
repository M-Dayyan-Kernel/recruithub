/** Mirrors the backend's VoiceScreeningPreview / VoiceScreeningChangeResult. */
export interface VoiceScreeningPreview {
  enabled: boolean
  in_phone_round: Array<{ candidate_id: string; name: string; state: string }>
  live_calls: number
  with_call_result: number
  in_interviews: number
}

export type MoveTo = 'interview' | 'resume'

export interface VoiceScreeningChangeResult {
  enabled: boolean
  move_to: MoveTo | null
  moved: number
  links_sent: number
  email_failed: string[]
  failed: string[]
  live_calls: number
  in_background?: number
}

const STATE_LABELS: Record<string, string> = {
  queued: 'waiting for the call',
  scheduled: 'call scheduled',
  retrying: 'retrying',
  flagged: 'flagged (no answer, declined or no phone)',
  cancelled: 'call cancelled',
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 waiting for the call · 1 retrying · 2 need attention", most common first. */
export function phoneRoundBreakdown(preview: VoiceScreeningPreview): string {
  const counts = new Map<string, number>()
  for (const c of preview.in_phone_round) counts.set(c.state, (counts.get(c.state) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, n]) => `${n} ${STATE_LABELS[state] ?? state}`)
    .join(' · ')
}

/** The lines under the choice: who is NOT moved, so nobody wonders where they went. */
export function unaffectedNotes(preview: VoiceScreeningPreview): string[] {
  const notes: string[] = []
  if (preview.live_calls > 0) {
    notes.push(`${plural(preview.live_calls, 'candidate is', 'candidates are')} on a call right now. ${preview.live_calls === 1 ? 'It finishes' : 'Those calls finish'} normally.`)
  }
  if (preview.with_call_result > 0) {
    notes.push(`${plural(preview.with_call_result, 'candidate has', 'candidates have')} a finished call and ${preview.with_call_result === 1 ? 'keeps its' : 'keep their'} result.`)
  }
  if (preview.in_interviews > 0) {
    notes.push(`${plural(preview.in_interviews, 'candidate is', 'candidates are')} already in Interviews and ${preview.in_interviews === 1 ? 'is' : 'are'} not affected.`)
  }
  return notes
}

/** The toast after a change, and whether anything needs HR's attention. */
export function resultMessage(result: VoiceScreeningChangeResult): { ok: boolean; text: string } {
  const head = result.enabled ? 'Voice screening is on' : 'Voice screening is off'
  if (result.move_to === 'resume') {
    return { ok: true, text: `${head}. ${plural(result.moved, 'candidate')} went back to Resume Screening.` }
  }
  if (result.move_to === 'interview') {
    const problems = result.failed.length + result.email_failed.length
    let text = `${head}. ${plural(result.moved, 'candidate')} moved to Interviews, ${plural(result.links_sent, 'link')} emailed.`
    if (result.in_background) {
      text += ` ${plural(result.in_background, 'more is', 'more are')} being moved in the background.`
    }
    return { ok: problems === 0, text }
  }
  return { ok: true, text: `${head}.` }
}
