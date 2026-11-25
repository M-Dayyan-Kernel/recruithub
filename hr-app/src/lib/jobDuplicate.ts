/**
 * "Duplicate as new job": a closed job cannot be reopened, so hiring for the same role again
 * starts a new job pre-filled from the old one. Only what HR wrote is copied. The new job gets
 * its own candidates, calls and interviews, and its topics are saved fresh (their ids dropped).
 */
import type { Job } from '../types/api.ts'
import type { JobFormContent } from './jobCreationDraft.ts'
import { editableQuestions } from './screeningQuestions.ts'

export const DUPLICATE_PARAM = 'duplicate'

export function duplicateJobPath(jobId: string): string {
  return `/jobs/new?${DUPLICATE_PARAM}=${encodeURIComponent(jobId)}`
}

export function jobToFormContent(job: Job): JobFormContent {
  return {
    title: job.title,
    description: job.description ?? '',
    skills: [...(job.required_skills ?? [])],
    skillInput: '',
    seniority: job.seniority_level ?? null,
    workMode: job.work_mode ?? null,
    workLocation: job.work_location ?? '',
    // The standard questions are the server's and are added to every job; copying them would
    // list them twice.
    extraQuestions: editableQuestions(job.screening_questions).map((q) => ({ ...q })),
    interviewTopics: (job.interview_topics ?? []).map(({ name, scope, skill_tag, seed_question, is_mandatory }) => ({
      name,
      scope,
      skill_tag,
      seed_question,
      is_mandatory,
    })),
    voiceScreeningEnabled: job.voice_screening_enabled ?? true,
    extensionCheckEnabled: job.extension_check_enabled ?? true,
    extensionCheckMode: job.extension_check_mode ?? 'shadow',
    pastedJd: '',
  }
}
