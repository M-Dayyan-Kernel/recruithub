import type { PipelineCandidate } from '../types/api.ts'
import { csvEscape } from './csv.ts'
import { describePipelineCandidate } from './pipelineStages.ts'

const HEADER = ['Name', 'Email', 'Phone', 'Stage', 'Status', 'Match %', 'Last updated']

/** The Candidates view as a CSV: one row per candidate with the one stage they are in. */
export function buildPipelineCsv(candidates: PipelineCandidate[]): string {
  const rows = candidates.map((c) => {
    const view = describePipelineCandidate(c)
    return [
      c.name,
      c.email ?? '',
      c.phone ?? '',
      view.label,
      view.detail,
      c.match_score == null ? '' : Math.round(c.match_score),
      c.updated_at,
    ]
  })
  return [HEADER, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}
