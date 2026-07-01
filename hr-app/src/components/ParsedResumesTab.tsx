import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
} from '@/lib/workflow'

function candidateDisplayName(candidate: Candidate): string {
  return (
    candidate.parsed_data?.name ??
    candidate.name ??
    `Candidate #${candidate.id.slice(0, 8)}`
  )
}

function candidateEmail(candidate: Candidate): string {
  return candidate.parsed_data?.email ?? candidate.email ?? '—'
}

function candidatePhone(candidate: Candidate): string {
  return candidate.parsed_data?.phone ?? candidate.phone ?? '—'
}

function candidateExperience(candidate: Candidate): string {
  const years = candidate.parsed_data?.total_experience_years
  if (years == null) return '—'
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

export interface ShortlistTriggeredPayload {
  candidateIds: string[]
  candidates: Candidate[]
}

interface Props {
  jobId: string
  parsedCandidates: Candidate[]
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  onShortlistTriggered: (payload: ShortlistTriggeredPayload) => void
  onSwitchToShortlisting: () => void
}

export function ParsedResumesTab({
  jobId,
  parsedCandidates,
  isLoading = false,
  isError = false,
  onRetry,
  onShortlistTriggered,
  onSwitchToShortlisting,
}: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filtered = parsedCandidates.filter((c) => {
    const term = search.toLowerCase()
    if (!term) return true
    return candidateDisplayName(c).toLowerCase().includes(term)
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/candidates/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast.success('Resume removed')
    },
    onError: () => toast.error('Failed to remove resume'),
  })

  const shortlistMutation = useMutation({
    mutationFn: (candidateIds: string[]) =>
      api.post(`/api/jobs/${jobId}/shortlist`, { candidate_ids: candidateIds }) as Promise<{
        candidate_ids?: string[]
      }>,
    onSuccess: (data, variables) => {
      const ids = data.candidate_ids ?? variables
      const snapshot = parsedCandidates.filter((c) => ids.includes(c.id))
      void queryClient.refetchQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      void queryClient.refetchQueries({ queryKey: ['shortlist', jobId] })
      void queryClient.refetchQueries({ queryKey: ['shortlist-status', jobId] })
      toast.success('AI shortlisting started')
      onShortlistTriggered({ candidateIds: ids, candidates: snapshot })
      onSwitchToShortlisting()
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to start shortlisting')
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Remove ${name}?`)) {
      deleteMutation.mutate(id)
    }
  }

  const handleSendToShortlisting = () => {
    const ids =
      selectedIds.size > 0 ? [...selectedIds] : parsedCandidates.map((c) => c.id)
    if (ids.length === 0) {
      toast.error('No parsed resumes available to shortlist')
      return
    }
    shortlistMutation.mutate(ids)
  }

  const allSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Parsed Resumes</h2>
        <p className="text-sm text-slate-500">
          Review parsed resumes and select candidates to send for AI shortlisting.
        </p>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="w-full max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates..."
            className={WORKFLOW_INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <div className="whitespace-nowrap text-sm font-medium text-slate-600">
            Total Parsed Resumes: {parsedCandidates.length}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={handleSendToShortlisting}
              disabled={parsedCandidates.length === 0 || shortlistMutation.isPending}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} disabled:opacity-50`}
            >
              {shortlistMutation.isPending ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send to AI Shortlisting'
              )}
            </button>
          </div>
        </div>
      </div>

      {isError && onRetry && <BackendError onRetry={onRetry} />}

      {!isError && (
        <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
          <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all parsed resumes"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={filtered.length === 0}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Candidate Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phone Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Years of Experience
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400">
                    <Loader2 size={20} className="mx-auto animate-spin text-slate-300" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                  <td colSpan={6} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                    {search ? `No results for "${search}"` : 'No parsed resumes available.'}
                  </td>
                </tr>
              ) : (
                filtered.map((candidate) => {
                  const name = candidateDisplayName(candidate)
                  const isDeleting =
                    deleteMutation.isPending && deleteMutation.variables === candidate.id

                  return (
                    <tr key={candidate.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${name}`}
                          checked={selectedIds.has(candidate.id)}
                          onChange={() => toggleOne(candidate.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-slate-800">{name}</td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidateEmail(candidate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidatePhone(candidate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-600">
                        {candidateExperience(candidate)}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => handleDelete(candidate.id, name)}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          title="Remove resume"
                        >
                          {isDeleting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ParsedResumesTab
