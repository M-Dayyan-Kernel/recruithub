import { Loader2 } from 'lucide-react'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  formatUploadedAt,
  resumeDisplayName,
} from '@/lib/workflow'

const PROGRESS_LABEL: Record<string, string> = {
  parsing: 'Extracting text…',
  parsed: 'Generating embedding…',
}

interface Props {
  parsingCandidates: Candidate[]
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
}

export function ParsingTab({
  parsingCandidates,
  isLoading = false,
  isError = false,
  onRetry,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Parsing Queue</h2>
        <p className="text-sm text-slate-500">
          Resumes currently being processed. They will automatically move to Parsed Resumes once
          parsing is complete.
        </p>
      </div>

      {isError && onRetry && <BackendError onRetry={onRetry} />}

      {!isError && (
        <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
          <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Resume Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded At
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Progress
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center">
                    <Loader2 size={20} className="mx-auto animate-spin text-slate-300" />
                  </td>
                </tr>
              ) : parsingCandidates.length === 0 ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={3} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    No resumes are currently being parsed.
                  </td>
                </tr>
              ) : (
                parsingCandidates.map((candidate) => (
                  <tr key={candidate.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-3 text-sm font-medium text-slate-800">
                      {resumeDisplayName(candidate)}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-600">
                      {formatUploadedAt(candidate.created_at)}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm text-indigo-600">
                        <Loader2 size={14} className="animate-spin" />
                        {PROGRESS_LABEL[candidate.parse_status] ?? 'Processing…'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ParsingTab
