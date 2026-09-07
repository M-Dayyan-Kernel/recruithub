import type { SignalType } from './types'

/**
 * Enforcement policy.
 *
 * This is a deliberate product decision that goes beyond the PRD: the PRD keeps
 * behavioural signals silent and never ends a session (§8.2, §17). Here, leaving
 * the interview screen warns the candidate once and ends the interview the next
 * time. Everything else still follows the PRD: detection, severity and the
 * recovery prompts are unchanged, and no other signal type can end a session.
 *
 * To go back to the PRD model, set `enabled: false`.
 */
export const ENFORCEMENT = {
  enabled: true,
  /** Warnings shown before the next occurrence ends the interview. */
  maxWarnings: 1,
  /** Only these signals warn the candidate and count toward ending. */
  enforced: ['TAB_CHANGE', 'WINDOW_CHANGE'] as SignalType[],
} as const

const MESSAGES: Partial<Record<SignalType, string>> = {
  TAB_CHANGE: 'You switched away from the interview tab.',
  WINDOW_CHANGE: 'You switched to another window or application.',
}

export function isEnforced(type: SignalType): boolean {
  return ENFORCEMENT.enabled && ENFORCEMENT.enforced.includes(type)
}

export function enforcementMessage(type: SignalType): string {
  return MESSAGES[type] ?? 'You left the interview screen.'
}

/**
 * Tracks how many enforced signals a session has produced.
 *
 * Each distinct signal counts once: a condition that deduplicates or escalates
 * stays one signal, so a candidate is not charged twice for the same lapse.
 */
export class EnforcementTracker {
  private counted = new Set<string>()
  warnings = 0
  ended = false

  /** 'warn', 'end', or null when the signal is not enforced or already counted. */
  consider(signal: { signal_id: string; signal_type: SignalType }): 'warn' | 'end' | null {
    if (this.ended) return null
    if (!isEnforced(signal.signal_type)) return null
    if (this.counted.has(signal.signal_id)) return null

    this.counted.add(signal.signal_id)
    this.warnings += 1
    if (this.warnings > ENFORCEMENT.maxWarnings) {
      this.ended = true
      return 'end'
    }
    return 'warn'
  }

  /** Warnings left before the next enforced signal ends the interview. */
  get remaining(): number {
    return Math.max(0, ENFORCEMENT.maxWarnings - this.warnings)
  }
}
