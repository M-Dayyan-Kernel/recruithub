import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { StandardScreeningQuestions, WorkMode } from '@/types/api'

/**
 * The locked screening questions for a job's title, work mode and location, so the form can show
 * them before the job exists. The server builds them (it also rebuilds them on save), which keeps
 * one copy of the wording. Typing is debounced; while a new answer loads the last one stays up.
 */
export function useStandardScreeningQuestions(
  title: string,
  workMode: WorkMode | null | undefined,
  workLocation: string,
) {
  const key = useDebouncedValue(
    { title: title.trim(), workMode: workMode ?? '', workLocation: workLocation.trim() },
    300,
  )
  return useQuery<StandardScreeningQuestions>({
    queryKey: ['standard-screening-questions', key.title, key.workMode, key.workLocation],
    queryFn: () =>
      api.get('/api/jobs/standard-screening-questions', {
        params: {
          title: key.title,
          ...(key.workMode ? { work_mode: key.workMode } : {}),
          ...(key.workLocation ? { work_location: key.workLocation } : {}),
        },
      }) as unknown as Promise<StandardScreeningQuestions>,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}
