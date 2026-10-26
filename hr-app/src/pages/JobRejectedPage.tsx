import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, Send, Undo2, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { RejectedCandidate, RejectedListResponse, RejectionEmailResponse } from '@/types/api'
import type { JobOutletContext } from '@/components/JobLayout'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'
import { REJECTED_FROM_LABEL } from '@/lib/stageLabels'
import { WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

const BATCH = 10 // the server takes at most this many per request

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function EmailState({ c }: { c: RejectedCandidate }) {
  if (c.email_state === 'emailed') {
    return <span className="text-[13px] text-ink-muted">Emailed {formatWhen(c.emailed_at)}</span>
  }
  if (c.email_state === 'sending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        Sending…
      </span>
    )
  }
  if (!c.can_email) return <span className="text-[13px] text-ink-muted">No email address</span>
  return <span className="text-[13px] font-medium text-warn">Not told yet</span>
}

export default function JobRejectedPage() {
  const { jobId } = useOutletContext<JobOutletContext>()
  const queryClient = useQueryClient()
  const [confirmAll, setConfirmAll] = useState(false)
  const [allError, setAllError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<RejectedListResponse>({
    queryKey: ['rejected', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/rejected`) as unknown as Promise<RejectedListResponse>,
    enabled: !!jobId,
  })
  const candidates = data?.candidates ?? []
  const toTell = candidates.filter((c) => c.email_state === 'not_told' && c.can_email)

  const refresh = () => {
    for (const key of ['rejected', 'shortlist', 'screening', 'interviews-pipeline', 'finalists', 'candidates', 'voice-screening']) {
      void queryClient.invalidateQueries({ queryKey: key === 'rejected' ? [key, jobId] : [key] })
    }
  }

  const send = async (ids: string[]): Promise<RejectionEmailResponse> => {
    const merged: RejectionEmailResponse = { results: [], sent: 0, failed: 0 }
    for (let i = 0; i < ids.length; i += BATCH) {
      const out = (await api.post(`/api/jobs/${jobId}/rejected/email`, {
        candidate_ids: ids.slice(i, i + BATCH),
      })) as unknown as RejectionEmailResponse
      merged.results.push(...out.results)
      merged.sent += out.sent
      merged.failed += out.failed
    }
    return merged
  }

  const reportEmail = (out: RejectionEmailResponse) => {
    const noEmail = out.results.filter((r) => r.status === 'no_email').length
    if (out.failed > 0 || noEmail > 0) {
      const parts = [`${out.sent} emailed`]
      if (out.failed) parts.push(`${out.failed} failed (still not told; try again)`)
      if (noEmail) parts.push(`${noEmail} without an email address`)
      toast.error(parts.join(', '))
    } else if (out.sent > 0) {
      toast.success(out.sent === 1 ? 'Rejection email sent' : `${out.sent} rejection emails sent`)
    } else {
      toast('Nobody to email: they were already told or are being sent.')
    }
  }

  const emailOne = useMutation({
    mutationFn: (id: string) => send([id]),
    onMutate: (id) => setBusyId(id),
    onSuccess: reportEmail,
    onError: (err: Error) => toast.error(err.message || 'Could not send the email'),
    onSettled: () => {
      setBusyId(null)
      refresh()
    },
  })

  const emailAll = useMutation({
    mutationFn: () => send(toTell.map((c) => c.candidate_id)),
    onSuccess: (out) => {
      reportEmail(out)
      setConfirmAll(false)
    },
    onError: (err: Error) => setAllError(err.message || 'Could not send the emails'),
    onSettled: refresh,
  })

  const reconsider = useMutation({
    mutationFn: (c: RejectedCandidate) => api.post(`/api/jobs/${jobId}/rejected/${c.candidate_id}/reconsider`),
    onMutate: (c) => setBusyId(c.candidate_id),
    onSuccess: (_d, c) =>
      toast.success(
        `${c.candidate_name ?? 'Candidate'} is back in ${REJECTED_FROM_LABEL[c.rejected_from ?? 'resume']}` +
          (c.rejected_from === 'interview' ? '. Send them a new interview link.' : ''),
      ),
    onError: (err: Error) => toast.error(err.message || 'Could not reconsider'),
    onSettled: () => {
      setBusyId(null)
      refresh()
    },
  })

  return (
    <div className="space-y-4">
      {isError && (
        <div className="rounded-lg border border-neg/30 bg-neg-soft px-4 py-3 text-sm text-neg">
          Failed to load rejected candidates.{' '}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Loading rejected candidates…
        </div>
      )}

      {!isLoading && !isError && candidates.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <UserX className="mx-auto mb-3 h-10 w-10 text-ink-subtle" aria-hidden />
          <p className="text-sm font-medium text-ink">Nobody is rejected</p>
          <p className="mt-1 text-sm text-ink-muted">
            Candidates you reject from any stage appear here. They are not emailed until you send it.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">
              <span className="font-mono tabular-nums">{toTell.length}</span> not told yet. You can
              reconsider anyone until they are emailed; emailing is final.
            </p>
            {toTell.length > 0 && (
              <button type="button" onClick={() => setConfirmAll(true)} className={BTN_PRIMARY}>
                <Send size={14} aria-hidden />
                Email all not told ({toTell.length})
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className={WORKFLOW_TABLE_CLASS}>
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Rejected from</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Candidate told?</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {candidates.map((c) => {
                  const busy = busyId === c.candidate_id
                  return (
                    <tr key={c.candidate_id}>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-medium text-ink">{c.candidate_name ?? 'Candidate'}</p>
                        {c.candidate_email && <p className="text-xs text-ink-muted">{c.candidate_email}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-muted">
                        {c.rejected_from ? REJECTED_FROM_LABEL[c.rejected_from] : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-muted">
                        <span className="font-mono tabular-nums">{formatWhen(c.rejected_at)}</span>
                        {c.rejected_by_name && <span className="block text-xs">by {c.rejected_by_name}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <EmailState c={c} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {c.has_report && (
                            <Link
                              to={`/jobs/${jobId}/candidates/${c.candidate_id}/report?tab=rejected`}
                              className={BTN_SECONDARY}
                            >
                              <FileText size={13} aria-hidden />
                              Report
                            </Link>
                          )}
                          {c.email_state === 'not_told' && c.can_email && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => emailOne.mutate(c.candidate_id)}
                              className={BTN_SECONDARY}
                            >
                              {busy && emailOne.isPending ? (
                                <Loader2 size={13} className="animate-spin" aria-hidden />
                              ) : (
                                <Send size={13} aria-hidden />
                              )}
                              Send email
                            </button>
                          )}
                          {c.can_reconsider && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => reconsider.mutate(c)}
                              className={BTN_SECONDARY}
                            >
                              {busy && reconsider.isPending ? (
                                <Loader2 size={13} className="animate-spin" aria-hidden />
                              ) : (
                                <Undo2 size={13} aria-hidden />
                              )}
                              Reconsider
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmAll && (
        <ConfirmDialog
          title={`Email ${toTell.length} rejected candidate${toTell.length === 1 ? '' : 's'}?`}
          body={
            <p>
              Each gets the rejection email now. This is final: once emailed, a candidate cannot be
              reconsidered. Candidates without an email address are skipped.
            </p>
          }
          confirmLabel={`Send ${toTell.length} email${toTell.length === 1 ? '' : 's'}`}
          busy={emailAll.isPending}
          error={allError}
          onConfirm={() => {
            setAllError(null)
            emailAll.mutate()
          }}
          onClose={() => {
            setConfirmAll(false)
            setAllError(null)
          }}
        />
      )}
    </div>
  )
}
