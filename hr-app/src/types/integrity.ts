/** AI-assistant extension detection: policy, blocklist and per-interview evidence. */

export type ExtensionPolicyMode = 'shadow' | 'enforce'
export type BlocklistCategory = 'ai_assistant' | 'interview_assistant'
export type BlocklistStatus = 'active' | 'inactive'

export interface ExtensionBlocklistEntry {
  id: string
  extension_id: string
  name: string
  category: BlocklistCategory
  reason: string
  listing_url: string | null
  status: BlocklistStatus
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

export interface ExtensionPolicyRules {
  intent: {
    keywords: Array<{ term: string; weight: number }>
    vendor_hosts: string[]
    vendor_host_weight: number
    homepage_weight: number
  }
  capability: {
    permissions: Record<string, number>
    broad_host_weight: number
  }
  thresholds: {
    intent_strong: number
    capability_strong: number
    intent_weak: number
  }
}

export interface ExtensionPolicy {
  version: number
  mode: ExtensionPolicyMode
  rules: ExtensionPolicyRules
  updated_at: string
  blocklist_active: number
  blocklist_total: number
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
}

// ── observed extensions (Super Admin catalog) ───────────────────────────────

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
