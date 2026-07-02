export interface Job {
  id: string
  title: string
  description: string
  required_skills: string[] | null
  experience_min?: number
  experience_max?: number
  screening_criteria?: string
  interview_evaluation_criteria?: string
  screening_call_from?: string | null
  screening_call_to?: string | null
  screening_timezone?: string
  status: 'open' | 'closed' | 'paused' | 'active' | 'draft'
  created_at: string
  updated_at: string
}

export interface ParsedData {
  name?: string | null
  email?: string | null
  phone?: string | null
  skills?: string[] | null
  total_experience_years?: number | null
  experience?: Array<{
    company: string
    title: string
    duration: string
    description: string
  }> | null
  education?: Array<{
    institution: string
    degree: string
    field: string
    year: string
  }> | null
  current_company?: string | null
  current_role?: string | null
}

export type HrDecision = 'pending' | 'approved' | 'rejected' | 'overridden'
export type HrFeedbackType =
  | 'correctly_shortlisted'
  | 'incorrectly_shortlisted'
  | 'correctly_rejected'
  | 'incorrectly_rejected'

export interface ShortlistResult {
  id: string
  candidate_id: string
  job_id: string
  match_score: number
  recommendation: 'shortlisted' | 'rejected' | 'review'
  strengths: string[]
  gaps: string[]
  reason: string
  hr_decision: HrDecision
  hr_feedback_type?: HrFeedbackType | null
  hr_comments?: string | null
  created_at: string
}

export interface ShortlistResultWithCandidate extends ShortlistResult {
  candidate_name?: string | null
  candidate_email?: string | null
}

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export interface SkippedCandidate {
  name: string
  reason: string
}

export type CallStatus = 'pending' | 'initiated' | 'in_progress' | 'completed' | 'failed'
export type ScreeningResult = 'pass' | 'fail' | 'needs_review'
export type CommunicationQuality = 'excellent' | 'good' | 'fair' | 'poor'

export interface ScreeningCall {
  id: string
  candidate_id: string
  job_id: string
  vapi_call_id?: string | null
  call_status: CallStatus
  availability?: string | null
  employment_status?: string | null
  relevant_experience?: string | null
  current_ctc?: string | null
  expected_ctc?: string | null
  notice_period?: string | null
  location_preference?: string | null
  communication_quality?: CommunicationQuality | null
  willingness_to_proceed?: boolean | null
  summary?: string | null
  result?: ScreeningResult | null
  transcript?: string | null
  ended_reason?: string | null
  call_outcome?: 'completed' | 'no_answer' | 'voicemail' | 'declined' | 'dropped' | 'failed' | null
  retry_count?: number
  created_at: string
}

export interface SystemSettings {
  allowed_phone_regions: string[]
  enforce_phone_geography: boolean
  screening_max_retries: number
  screening_retry_delay_seconds: number
  updated_at: string
}

export interface ScreeningTriggerResponse {
  initiated: number
  queued: number
  skipped: Array<{ id?: string; name?: string; reason: string }>
}

// ---------------------------------------------------------------------------
// Interview
// ---------------------------------------------------------------------------

export interface InterviewSession {
  id: string
  candidate_id: string
  job_id: string
  unique_token: string
  status: 'pending' | 'in_progress' | 'completed'
  candidate_name?: string
  job_title?: string
  interview_url?: string
  email_sent_at?: string
  started_at?: string
  completed_at?: string
  created_at: string
}

export interface InterviewReport {
  id: string
  candidate_id: string
  job_id: string
  technical_fit_score?: number
  communication_score?: number
  problem_solving_score?: number
  experience_score?: number
  role_alignment_score?: number
  overall_score?: number
  strengths?: string[]
  weaknesses?: string[]
  jd_fit?: string
  final_recommendation?: string
  summary?: string
  transcript_summary?: string
  candidate_name?: string | null
  job_title?: string | null
  created_at: string
}

export interface ShortlistStatusResponse {
  in_progress: boolean
  candidate_ids: string[]
  completed: number
  total: number
  failed: number
}

export interface Candidate {
  id: string
  job_id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  resume_file_path?: string | null
  original_filename?: string | null
  parsed_data?: ParsedData | null
  parse_status:
    | 'pending_parse'
    | 'parse_queued'
    | 'parsing'
    | 'parsed'
    | 'ready'
    | 'parse_failed'
  created_at: string
}
