export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

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
  voice_screening_enabled?: boolean
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
  skip_ai_shortlist?: boolean
}

export interface ShortlistDecisionResponse extends ShortlistResult {
  screening_skipped?: boolean
  interview_session_id?: string | null
  interview_email_sent?: boolean | null
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
  screening_enabled: boolean
  screening_max_retries: number
  screening_retry_delay_seconds: number
  company_name: string
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
  common_placeholders: string[]
  company_name: string
}

export interface ScreeningTriggerResponse {
  initiated: number
  queued: number
  skipped: Array<{ id?: string; name?: string; reason: string }>
}

// ---------------------------------------------------------------------------
// API keys & talentOS connections
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string
  name: string
  description?: string | null
  key_prefix: string
  is_active: boolean
  last_used_at?: string | null
  created_at: string
  updated_at: string
}

export interface ApiKeyListResponse {
  data: ApiKey[]
  total: number
}

export interface ApiKeyCreatedResponse extends ApiKey {
  full_key: string
}

export interface ConnectionFieldResponse {
  configured: boolean
  source: 'tenant' | 'platform' | 'missing'
  hint?: string | null
}

export interface TalentosConnectionResponse {
  fields: Record<string, ConnectionFieldResponse>
}

export interface TalentosConnectionUpdate {
  talentos_be_url?: string | null
  talentos_be_api_key?: string | null
}

export interface TalentosConnectResponse {
  flow_id?: string | null
  state: string
  operation?: string | null
  external_tenant_id?: string | null
  attempts?: number
  ping_a_verified?: boolean
  ping_b_verified?: boolean
  rhub_key_id?: string | null
  tal_key_id?: string | null
  result?: string | null
  already_in_progress?: boolean
}

export interface PlatformConnectionItem {
  tenant_id: string
  name: string
  slug: string
  is_active: boolean
  verification_status: 'pending' | 'approved' | 'rejected'
  state: string
  flow_id?: string | null
  ping_a_verified?: boolean
  ping_b_verified?: boolean
  connected_at?: string | null
  last_error?: string | null
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
  hr_decision?: 'pending' | 'approved' | 'rejected'
  candidate_name?: string
  job_title?: string
  interview_url?: string
  email_sent_at?: string
  started_at?: string
  completed_at?: string
  scheduled_interview_at?: string | null
  created_at: string
  mock_mode?: boolean
}

export type InterviewPipelineTab =
  | 'pending'
  | 'scheduled'
  | 'ongoing'
  | 'completed'
  | 'flagged'
  | 'finalists'

export interface InterviewPipelineCounts {
  pending: number
  scheduled: number
  ongoing: number
  completed: number
  flagged: number
  finalists?: number
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
  hr_decision?: 'pending' | 'approved' | 'rejected' | null
}

export interface InterviewPipelineResponse {
  counts: InterviewPipelineCounts
  candidates: InterviewPipelineCandidate[]
}

export interface FinalistCandidate {
  candidate_id: string
  session_id: string
  candidate_name?: string | null
  email?: string | null
  phone?: string | null
  current_ctc?: string | null
  expected_ctc?: string | null
  total_experience_years?: number | null
  report_overall_score?: number | null
  report_recommendation?: string | null
  hr_decision: string
  completed_at?: string | null
}

export interface FinalistsResponse {
  candidates: FinalistCandidate[]
}

export interface TranscriptSegment {
  speaker: 'ai' | 'candidate'
  text: string
  start_sec: number
  end_sec: number
}

export interface VideoProctoringFlag {
  timestamp: string
  event: string
  severity: string
  confidence: number
}

export interface VideoProctoringBreakdown {
  face: number
  gaze: number
  objects: number
}

export interface VideoProctoringResult {
  duration?: string | null
  frame_count?: number | null
  flags?: VideoProctoringFlag[]
  verdict?: string | null
  score?: number | null
  flag_count?: number | null
  breakdown?: VideoProctoringBreakdown | null
}

export interface VideoProctoringSummary {
  status: string
  error?: string | null
  result?: VideoProctoringResult | null
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
  transcript_segments?: TranscriptSegment[] | null
  recording_url?: string | null
  recording_key?: string | null
  video_proctoring?: VideoProctoringSummary | null
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
  pipeline_status: 'queued' | 'processing' | 'completed' | 'failed'
  skip_ai_shortlist?: boolean
  status?: string
  years_experience?: number | null
  current_ctc?: string | null
  expected_ctc?: string | null
  notice_period?: string | null
  last_working_day?: string | null
  created_at: string
}

export interface CandidateListItem {
  id: string
  job_id: string
  job_title: string
  name: string
  email: string
  phone?: string | null
  years_experience?: number | null
  current_ctc?: string | null
  expected_ctc?: string | null
  notice_period?: string | null
  last_working_day?: string | null
  hiring_stage: string
  match_score?: number | null
  status: string
  date_applied: string
  pipeline_status: string
}

export interface CandidateProfile extends CandidateListItem {
  parsed_data?: ParsedData | null
  resume_file_path?: string | null
  shortlist?: ShortlistResult | null
  screening?: ScreeningCall | null
  interview_sessions?: InterviewSession[]
  timeline?: AuditLogEntry[]
}

export interface CandidateUpdatePayload {
  name?: string
  email?: string
  phone?: string | null
  status?: string
  years_experience?: number | null
  current_ctc?: string | null
  expected_ctc?: string | null
  notice_period?: string | null
  last_working_day?: string | null
}

export interface AuditLogEntry {
  id: string
  created_at: string
  actor_name: string
  actor_role: string
  action: string
  entity_type: string
  subject_label: string
  feature: string
  job_id?: string | null
}

// ---------------------------------------------------------------------------
// Auth / Users
// ---------------------------------------------------------------------------

export type UserRole = 'superadmin' | 'admin' | 'hr'
export type TenantMemberRole = 'admin' | 'hr'

export interface User {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
  tenant_name?: string | null
  home_tenant_id?: string | null
  active_tenant_id?: string | null
  active_tenant_name?: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface SignupRequest {
  organization_name: string
  email: string
  password: string
  full_name: string
  company_registration_number?: string
  gst_document: File
}

export interface SignupPendingResponse {
  message: string
  organization_name: string
  email: string
  verification_status: 'pending'
}

export interface AcceptInviteRequest {
  token: string
  password: string
  full_name: string
}

export interface InvitePublic {
  email: string
  role: TenantMemberRole
  organization_name: string
  expires_at: string
}

export interface InviteCreate {
  email: string
  role: TenantMemberRole
}

export interface InviteResponse {
  id: string
  email: string
  role: TenantMemberRole
  token: string
  invite_url: string
  expires_at: string
  created_at: string
  email_sent?: boolean
}

export interface InviteListItem {
  id: string
  email: string
  role: TenantMemberRole
  invite_url: string
  expires_at: string
  created_at: string
  status: 'pending' | 'expired'
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export interface UserCreate {
  email: string
  full_name: string
  password: string
  role: TenantMemberRole
}

export interface UserUpdate {
  full_name?: string
  role?: TenantMemberRole
  password?: string
  is_active?: boolean
}

export interface TenantListItem {
  id: string
  name: string
  slug: string
  is_active: boolean
  verification_status: 'pending' | 'approved' | 'rejected'
  company_registration_number?: string | null
  gst_document_filename?: string | null
  has_gst_document?: boolean
  admin_email?: string | null
  admin_full_name?: string | null
  created_at: string
  user_count: number
  job_count: number
}

export interface TenantCreateRequest {
  name: string
  admin_email: string
  admin_full_name: string
  admin_password: string
}

export interface TenantUpdateRequest {
  name?: string
  is_active?: boolean
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: string
  created_at: string
  tenant_id?: string | null
  actor_user_id: string | null
  actor_name: string
  actor_role: string
  action: string
  entity_type: string
  entity_id: string | null
  subject_label: string
  feature: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  job_id: string | null
}

export interface AuditLogListResponse {
  items: AuditLog[]
  total: number
  limit: number
  offset: number
}
