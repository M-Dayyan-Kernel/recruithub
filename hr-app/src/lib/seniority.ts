import type { SeniorityLevel } from '@/types/api'

/** The four levels, in the order they are offered. Mirrors `SeniorityLevel` in the API. */
export const SENIORITY_OPTIONS: { value: SeniorityLevel; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
]

export function seniorityLabel(level: SeniorityLevel | null | undefined): string | null {
  return SENIORITY_OPTIONS.find((option) => option.value === level)?.label ?? null
}
