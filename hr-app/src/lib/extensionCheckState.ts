import type { ExtensionCheckStamp, IntegritySummary } from '../types/integrity.ts'

/** The scan error the candidate's page records when it could not load the check settings. */
export const POLICY_UNAVAILABLE = 'policy_unavailable'

/**
 * What the report can say about an interview's extension check.
 *
 *  - `off`: the job had the check switched off and nothing was recorded.
 *  - `unavailable`: the check could not run because the settings could not be loaded; never read
 *    as clean.
 *  - `checked`: there is scan evidence to show.
 *  - `not_recorded`: nothing on record, as for interviews that predate the check. Also not clean.
 *
 * Evidence wins over the stamp: a job switched off mid-interview still shows what was recorded
 * before.
 */
export type ExtensionCheckState = 'off' | 'unavailable' | 'checked' | 'not_recorded'

export function extensionCheckState(
  integrity: IntegritySummary | null | undefined,
  stamp: ExtensionCheckStamp | null | undefined,
): ExtensionCheckState {
  if (integrity && integrity.scans > 0) {
    return integrity.latest_error_code === POLICY_UNAVAILABLE ? 'unavailable' : 'checked'
  }
  if (stamp?.enabled === false) return 'off'
  return 'not_recorded'
}

/** Who turned it off matters to the reader: the organization's Admin, or this job's own switch. */
export function extensionCheckOffMessage(stamp: ExtensionCheckStamp | null | undefined): string {
  return stamp?.disabled_by === 'org'
    ? 'Extension check was turned off for the organization.'
    : 'Extension check was turned off for this job.'
}
export const POLICY_UNAVAILABLE_MESSAGE =
  'The extension check could not run because the interview page could not load the check settings. This is not a clean result.'
