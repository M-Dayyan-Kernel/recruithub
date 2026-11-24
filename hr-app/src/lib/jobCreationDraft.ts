import type { InterviewTopic, ScreeningQuestion, SeniorityLevel, WorkMode } from '@/types/api'
import type { ExtensionPolicyMode } from '@/types/integrity'

export interface JobCreationDraft {
  version: 1
  step: number
  title: string
  description: string
  skills: string[]
  skillInput: string
  seniority: SeniorityLevel | null
  workMode: WorkMode | null
  workLocation: string
  extraQuestions: ScreeningQuestion[]
  interviewTopics: InterviewTopic[]
  voiceScreeningEnabled: boolean
  extensionCheckEnabled: boolean
  extensionCheckMode: ExtensionPolicyMode
  /** A pasted job description not yet read into the form. Optional: older drafts lack it. */
  pastedJd?: string
}

/** What the job form holds that would be lost by leaving: the draft fields, without the step. */
export type JobFormContent = Omit<JobCreationDraft, 'version' | 'step'>

/**
 * One string for the form's content, compared to tell whether there are unsaved changes.
 * Topics and questions are reduced to what HR wrote: their client-side ids are regenerated when
 * a draft is restored and must not make a restored form look edited.
 */
export function jobFormSnapshot(content: JobFormContent): string {
  return JSON.stringify({
    title: content.title,
    description: content.description,
    skills: content.skills,
    skillInput: content.skillInput,
    seniority: content.seniority,
    workMode: content.workMode,
    workLocation: content.workLocation,
    extraQuestions: content.extraQuestions.map((q) => [q.question, q.kind ?? null]),
    interviewTopics: content.interviewTopics.map((t) => [
      t.name,
      t.scope,
      t.skill_tag,
      t.seed_question,
      t.is_mandatory,
    ]),
    voiceScreeningEnabled: content.voiceScreeningEnabled,
    extensionCheckEnabled: content.extensionCheckEnabled,
    extensionCheckMode: content.extensionCheckMode,
    pastedJd: content.pastedJd ?? '',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Treat browser storage as untrusted; older or incomplete drafts are ignored. */
export function readJobCreationDraft(key: string): JobCreationDraft | null {
  try {
    const draft: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!isRecord(draft) || draft.version !== 1 || !Number.isInteger(draft.step) || Number(draft.step) < 1 || Number(draft.step) > 4) return null
    if (!['title', 'description', 'skillInput', 'workLocation'].every(key => typeof draft[key] === 'string')) return null
    if (!['voiceScreeningEnabled', 'extensionCheckEnabled'].every(key => typeof draft[key] === 'boolean')) return null
    if (!Array.isArray(draft.skills) || !draft.skills.every(value => typeof value === 'string')) return null
    if (![null, 'intern', 'junior', 'mid', 'senior'].includes(draft.seniority as SeniorityLevel | null)) return null
    if (![null, 'remote', 'hybrid', 'onsite'].includes(draft.workMode as WorkMode | null)) return null
    if (!['shadow', 'enforce'].includes(String(draft.extensionCheckMode))) return null
    if (!Array.isArray(draft.extraQuestions) || !draft.extraQuestions.every(question => isRecord(question) && typeof question.id === 'string' && typeof question.question === 'string' && [undefined, 'role', 'custom'].includes(question.kind as undefined | string))) return null
    if (!Array.isArray(draft.interviewTopics) || !draft.interviewTopics.every(topic => isRecord(topic) && ['name', 'scope', 'skill_tag', 'seed_question'].every(key => typeof topic[key] === 'string') && typeof topic.is_mandatory === 'boolean')) return null
    return draft as unknown as JobCreationDraft
  } catch {
    return null
  }
}
