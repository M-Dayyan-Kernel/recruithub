export interface ScreeningQuestion {
  id: string
  question: string
}

export interface InterviewQuestion {
  id: string
  question: string
  score: number
}

export interface PointCoverage {
  point: string
  covered: boolean
}

export interface InterviewQuestionScore extends InterviewQuestion {
  earned_score?: number | null
  notes?: string | null
  candidate_answer?: string | null
  expected_points?: string[] | null
  candidate_points?: string[] | null
  point_coverage?: PointCoverage[] | null
}

export interface ParsedJobDescription {
  title: string
  description: string
  required_skills: string[]
  experience_min?: number | null
  experience_max?: number | null
  screening_questions?: ScreeningQuestion[]
  interview_questions?: InterviewQuestion[]
}

export interface Job {
  id: string
  title: string
  description: string
  required_skills: string[] | null
  experience_min?: number
  experience_max?: number
  screening_questions?: ScreeningQuestion[]
  interview_questions?: InterviewQuestion[]
  interview_total_score?: number
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
  interview_queued_at?: string | null
  has_interview_session?: boolean
  created_at: string
}

export interface SystemSettings {
  allowed_phone_regions: string[]
  enforce_phone_geography: boolean
  screening_max_retries: number
  screening_retry_delay_seconds: number
  updated_at: string
}

export interface EmailTemplateEntry {
  subject: string
  body_html: string
  version: number
  updated_at?: string | null
}

export interface EmailTemplatesResponse {
  templates: Record<string, EmailTemplateEntry>
  required_placeholders: Record<string, string[]>
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
  status: 'pending' | 'in_progress' | 'completed' | 'expired' | 'assessment_failed' | 'assessed'
  candidate_name?: string
  job_title?: string
  interview_url?: string
  email_sent_at?: string
  started_at?: string
  completed_at?: string
  scheduled_interview_at?: string | null
  created_at: string
}

export type InterviewPipelineTab = 'pending' | 'scheduled' | 'ongoing' | 'completed' | 'flagged'

export interface InterviewPipelineCounts {
  pending: number
  scheduled: number
  ongoing: number
  completed: number
  flagged: number
}

export type InterviewAssessmentStatus = 'none' | 'generating' | 'ready' | 'failed'

export interface InterviewPipelineCandidate {
  candidate_id: string
  candidate_name?: string | null
  tab: InterviewPipelineTab
  has_report: boolean
  session?: InterviewSession | null
  report_overall_score?: number | null
  report_recommendation?: string | null
  assessment_status?: InterviewAssessmentStatus
  flag_reason?: string | null
  can_reschedule?: boolean
  actions_disabled?: boolean
  has_active_session?: boolean
}

export interface InterviewPipelineResponse {
  counts: InterviewPipelineCounts
  candidates: InterviewPipelineCandidate[]
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
  rubric_total?: number | null
  question_scores?: InterviewQuestionScore[]
  strengths?: string[]
  weaknesses?: string[]
  jd_fit?: string
  final_recommendation?: string
  summary?: string
  transcript_summary?: string
  transcript?: string | null
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
