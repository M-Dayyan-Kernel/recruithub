/**
 * Where to open right after a rejected candidate is reconsidered: the page of the stage they went
 * back to, on the tab that lists them. The server says both (`restored_to` and `tab`); a missing
 * tab falls back to that page's first one.
 */

export type RestoredTo = 'resume' | 'phone' | 'interview'

const PAGE: Record<RestoredTo, { segment: string; firstTab: string }> = {
  resume: { segment: 'shortlist', firstTab: 'results' },
  phone: { segment: 'screening', firstTab: 'pending' },
  interview: { segment: 'interviews', firstTab: 'scheduled' },
}

export function reconsiderPath(jobId: string, restoredTo: RestoredTo, tab?: string | null): string {
  const { segment, firstTab } = PAGE[restoredTo]
  return `/jobs/${jobId}/${segment}?tab=${tab || firstTab}`
}
