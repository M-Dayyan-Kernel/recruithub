export type SkillMatchStatus = 'matched' | 'gap' | 'unclear'

export interface SkillMatchEntry {
  skill: string
  status: SkillMatchStatus
  source?: string
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

function findRelated(requiredSkill: string, items: string[]): string | undefined {
  const required = normalize(requiredSkill)
  if (!required) return undefined

  return items.find((item) => {
    const normalized = normalize(item)
    return normalized.includes(required) || required.includes(normalized)
  })
}

export function buildSkillMatchMap(
  requiredSkills: string[],
  strengths: string[],
  gaps: string[],
): SkillMatchEntry[] {
  return requiredSkills.map((skill) => {
    const strengthMatch = findRelated(skill, strengths)
    if (strengthMatch) {
      return { skill, status: 'matched', source: strengthMatch }
    }

    const gapMatch = findRelated(skill, gaps)
    if (gapMatch) {
      return { skill, status: 'gap', source: gapMatch }
    }

    return { skill, status: 'unclear' }
  })
}

export function summarizeSkillMatches(entries: SkillMatchEntry[]): {
  matched: number
  gap: number
  unclear: number
} {
  return {
    matched: entries.filter((entry) => entry.status === 'matched').length,
    gap: entries.filter((entry) => entry.status === 'gap').length,
    unclear: entries.filter((entry) => entry.status === 'unclear').length,
  }
}
