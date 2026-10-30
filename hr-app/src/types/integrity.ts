/** AI-assistant extension detection: policy, blocklist and per-interview evidence. */

export type ExtensionPolicyMode = 'shadow' | 'enforce'
export type BlocklistCategory = 'ai_assistant' | 'interview_assistant'
export type BlocklistStatus = 'active' | 'inactive'

export type BlocklistOrigin = 'default' | 'custom'

export interface ExtensionBlocklistEntry {
  id: string
  extension_id: string
  name: string
  category: BlocklistCategory
  reason: string
  listing_url: string | null
  status: BlocklistStatus
  /** `default` entries came from the starting list; `custom` ones were added here. */
  origin: BlocklistOrigin
  verified_on: string | null
  created_at: string
  updated_at: string
}

export interface ExtensionBlocklistCreate {
  extension_id: string
  name: string
  category: BlocklistCategory
  reason: string
  listing_url?: string | null
  status?: BlocklistStatus
}

/** Everything but the id, which is fixed once an entry exists. */
export type ExtensionBlocklistUpdate = Partial<Omit<ExtensionBlocklistCreate, 'extension_id'>>

/** An organization's extension-check state. Admins edit the list; HR sees `can_edit: false`. */
export interface ExtensionOrgPolicy {
  version: number
  entry_count: number
  active_count: number
  entry_cap: number
  defaults_present: number
  defaults_total: number
  can_edit: boolean
  updated_at: string
}

export interface RestoreDefaultsResult {
  added: number
  reset: number
  unchanged: number
}

/** What a report shows about the check an interview ran under. `enabled` null = before this existed. */
export interface ExtensionCheckStamp {
  enabled: boolean | null
  mode: ExtensionPolicyMode | null
  policy_version: number | null
}

// ── per-interview evidence (HR report) ──────────────────────────────────────

export interface IntegrityFlaggedExtension {
  id: string
  name: string
  reason_code: 'known_id' | 'heuristic_strong' | 'heuristic_weak' | string
  blocked: boolean
  would_block: boolean
  intent_score: number
  capability_score: number
  signals: string[]
  first_seen_phase: string
  seen_in_scans: number
}

export interface IntegrityTimelineEntry {
  phase: string
  outcome: 'clear' | 'flagged' | 'blocked' | 'unavailable' | string
  flagged_count: number
  mode: string | null
  at: string
}

export interface IntegritySummary {
  scans: number
  latest_outcome: string
  was_ever_blocked: boolean
  unavailable_scans: number
  flagged_extensions: IntegrityFlaggedExtension[]
  timeline: IntegrityTimelineEntry[]
  note: string | null
  /** Set to `policy_unavailable` when the latest scan could not load the policy. */
  latest_error_code?: string | null
}

// ── seen extensions (one catalog per organization) ───────────────────────────────

export type ObservedStatus = 'new' | 'dismissed'
export type ObservedReopenReason = 'content_changed' | 'stronger_match'

/** Facts about one extension only: no candidate, interview, job or organization. */
export interface ObservedExtension {
  id: string
  extension_id: string
  name: string
  description: string | null
  strongest_reason: 'heuristic_weak' | 'heuristic_strong' | string
  times_seen: number
  first_seen_at: string
  last_seen_at: string
  status: ObservedStatus
  reopened_reason: ObservedReopenReason | null
  listing_url: string | null
}

export interface ObservedExtensionPage {
  items: ObservedExtension[]
  total: number
  limit: number
  offset: number
}
