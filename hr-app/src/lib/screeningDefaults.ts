import type { ScreeningQuestion } from '@/types/api'

const DEFAULT_TEMPLATES: Array<{ id: string; question: string }> = [
  {
    id: 'screening-default-availability',
    question:
      'When are you available to start a new role? Are you currently looking actively?',
  },
  {
    id: 'screening-default-employment',
    question: 'Are you currently employed? What is your current role and company?',
  },
  {
    id: 'screening-default-experience',
    question:
      'Can you briefly describe your most relevant experience for this {job_title} role?',
  },
  {
    id: 'screening-default-current-ctc',
    question: 'What is your current compensation package (annual CTC)?',
  },
  {
    id: 'screening-default-expected-ctc',
    question: 'What are your salary expectations for this role?',
  },
  {
    id: 'screening-default-notice',
    question: 'What is your notice period at your current company?',
  },
  {
    id: 'screening-default-location',
    question: 'What is your remote, hybrid, or on-site preference?',
  },
  {
    id: 'screening-default-interest',
    question: 'Are you interested in moving forward with this opportunity?',
  },
]

export function getDefaultScreeningQuestions(jobTitle = 'this'): ScreeningQuestion[] {
  const title = jobTitle.trim() || 'this'
  return DEFAULT_TEMPLATES.map(({ id, question }) => ({
    id,
    question: question.replace('{job_title}', title),
  }))
}

export function mergeScreeningQuestions(
  existing: ScreeningQuestion[] | undefined,
  additional: ScreeningQuestion[] | undefined,
  jobTitle = '',
): ScreeningQuestion[] {
  const base = existing?.length ? [...existing] : getDefaultScreeningQuestions(jobTitle)
  const seen = new Set(base.map((q) => q.question.trim().toLowerCase()))

  for (const item of additional ?? []) {
    const question = item.question.trim()
    if (!question) continue
    const key = question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    base.push({ id: item.id || crypto.randomUUID(), question })
  }

  return base
}
