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
