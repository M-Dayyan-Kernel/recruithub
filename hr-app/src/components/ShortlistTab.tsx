import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, Users, CheckCircle, XCircle, Download, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import type { ShortlistResultWithCandidate, SystemSettings } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import MenuButton from '@/components/stage/MenuButton'
import StageToolbar, { StageSearch } from '@/components/stage/StageToolbar'
import { ShortlistTable } from '@/components/shortlist/ShortlistTable'
import { ShortlistTableSkeleton } from '@/components/shortlist/ShortlistTableSkeleton'
import { BulkDecisionDialog } from '@/components/shortlist/ShortlistDecisionControls'
import { isVoiceScreeningEffective } from '@/lib/voiceScreening'
import { isAwaitingDecision } from '@/lib/shortlistDecision'
import { navigateAfterScreeningSkipped } from '@/hooks/useShortlistApproveNavigation'
import {
  buildShortlistCsv,
  downloadTextFile,
  exportTimestamp,
  slugifyFilename,
} from '@/lib/shortlistReportExport'
import { checkBundleSize } from '@/lib/pdf/limits'

const REC_CONFIG = {
  shortlisted: { label: 'Pass', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Fail', className: 'bg-rose-100 text-rose-700' },
  review: { label: 'Needs Review', className: 'bg-amber-100 text-amber-700' },
} as const

type RecommendationFilter = 'all' | keyof typeof REC_CONFIG

const RECOMMENDATION_FILTER_OPTIONS: { value: RecommendationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'shortlisted', label: 'Pass' },
  { value: 'rejected', label: 'Fail' },
  { value: 'review', label: 'Review' },
]

const SHORTLIST_FILTER_SELECT_CLASS =
  'h-9 w-[7.5rem] shrink-0 rounded-lg border border-line bg-surface py-0 pl-3 pr-8 text-left text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'


const SHORTLIST_EMPTY_STATE_CLASS = 'flex min-h-[360px] flex-col items-center justify-center px-6 text-center'

function BulkActionButtons({
  approveLabel,
  rejectLabel,
  approvingAll,
  rejectingAll,
  onApproveAll,
  onRejectAll,
}: {
  approveLabel: string
  rejectLabel: string
  approvingAll: boolean
  rejectingAll: boolean
  onApproveAll: () => void
  onRejectAll: () => void
}) {
  const disabled = approvingAll || rejectingAll

  return (
    <div className="inline-grid w-auto shrink-0 min-w-[15rem] grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
      <button
        type="button"
        onClick={onApproveAll}
        disabled={disabled}
        className="inline-flex h-9 items-center justify-center gap-1.5 bg-pos-soft px-3 text-sm font-semibold text-pos transition-colors hover:bg-pos hover:text-accent-ink focus:outline-none focus:ring-2 focus:ring-inset focus:ring-pos/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {approvingAll ? (
          <>
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className="truncate">Approving…</span>
          </>
        ) : (
          <>
            <CheckCircle size={14} className="shrink-0" />
            <span className="truncate">{approveLabel}</span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={onRejectAll}
        disabled={disabled}
        className="inline-flex h-9 items-center justify-center gap-1.5 bg-surface px-3 text-sm font-semibold text-neg transition-colors hover:bg-neg-soft focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neg/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {rejectingAll ? (
          <>
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className="truncate">Rejecting…</span>
          </>
        ) : (
          <>
            <XCircle size={14} className="shrink-0" />
            <span className="truncate">{rejectLabel}</span>
          </>
        )}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ShortlistTab
// ---------------------------------------------------------------------------

interface Props {
  jobId: string
  requiredSkills?: string[]
  jobTitle?: string
  voiceScreeningEnabled?: boolean
}

/**
 * The Resume Screening list: scored candidates still awaiting a decision, and nobody else.
 * Once approved a candidate is in Phone screening (or Interviews), once rejected in Rejected,
 * so they are not listed here; the job's Candidates view shows where everyone is.
 */
export function ShortlistTab({ jobId, requiredSkills = [], jobTitle, voiceScreeningEnabled }: Props) {
  const [search, setSearch] = useState('')
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>('all')

  const { data: results, isLoading, isFetching, isError, refetch } = useQuery<
    ShortlistResultWithCandidate[]
  >({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<
        ShortlistResultWithCandidate[]
      >,
    enabled: !!jobId,
    // A decision made elsewhere (another tab, another user) should show on the next visit
    // rather than a 30s-old answer.
    staleTime: 0,
  })

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })
  const screeningEffective = isVoiceScreeningEffective(settings, {
    voice_screening_enabled: voiceScreeningEnabled,
  })
  const navigate = useNavigate()

  const allScored = results ?? []
  const scoredResults = allScored.filter(isAwaitingDecision)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredScored = scoredResults.filter((r) => {
    if (recommendationFilter !== 'all' && r.recommendation !== recommendationFilter) {
      return false
    }
    if (!normalizedSearch) return true
    const name = (r.candidate_name ?? '').toLowerCase()
    const email = (r.candidate_email ?? '').toLowerCase()
    return name.includes(normalizedSearch) || email.includes(normalizedSearch)
  })

  // Bulk approve/reject by AI recommendation (shortlisted = passed, rejected = failed)
  const queryClient = useQueryClient()
  const [approvingAll, setApprovingAll] = useState(false)
  const [rejectingAll, setRejectingAll] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  // The names are captured when the dialog opens: the list refetches while the batch
  // runs, and a dialog that re-derives them would empty itself before it closes.
  const [bulkConfirm, setBulkConfirm] = useState<{ decision: 'approved' | 'rejected'; names: string[]; ids: Set<string> } | null>(null)

  // Only rows still awaiting a decision: approved rows are locked, and a rejected row
  // is not "failed" work for the batch to redo.
  const bulkTargets = (decision: 'approved' | 'rejected') =>
    scoredResults.filter(
      (r) =>
        r.hr_decision === 'pending' &&
        r.recommendation === (decision === 'approved' ? 'shortlisted' : 'rejected'),
    )

  const requestBulk = (decision: 'approved' | 'rejected') => {
    if (bulkTargets(decision).length === 0) {
      toast(
        decision === 'approved'
          ? 'No resume-passed candidates pending approval.'
          : 'No resume-failed candidates pending rejection.',
      )
      return
    }
    setBulkConfirm({
      decision,
      names: bulkTargets(decision).map((r) => r.candidate_name ?? 'Candidate'),
      ids: new Set(bulkTargets(decision).map((r) => r.id)),
    })
  }

  // The batch acts on the rows HR was shown, and only those still awaiting a decision:
  // a row someone else decided in the meantime is left alone.
  const confirmedTargets = (decision: 'approved' | 'rejected') =>
    bulkTargets(decision).filter((r) => !bulkConfirm || bulkConfirm.ids.has(r.id))

  const handleApproveAll = async () => {
    const toApprove = confirmedTargets('approved')
    if (toApprove.length === 0) return
    setApprovingAll(true)
    try {
      const settled = await Promise.allSettled(
        toApprove.map(
          (r) =>
            api.patch(`/api/shortlist/${r.id}/decision`, {
              hr_decision: 'approved',
            }) as unknown as Promise<{ screening_skipped?: boolean; interview_email_sent?: boolean | null }>,
        ),
      )
      const responses = settled.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))
      const failed = settled.length - responses.length
      const plural = (n: number) => `${n} candidate${n !== 1 ? 's' : ''}`
      const anyEmailFailed =
        !screeningEffective && responses.some((r) => r.screening_skipped && r.interview_email_sent === false)
      if (failed > 0) {
        // Most often a row that changed under us (approved from another tab).
        toast.error(
          (responses.length > 0
            ? `Approved ${plural(responses.length)}, but ${failed} could not be updated.`
            : 'Could not approve.') +
            (anyEmailFailed ? ' Some interview emails also failed.' : '') +
            ' The list has been refreshed.',
        )
      } else if (anyEmailFailed) {
        toast.error(`Approved ${plural(responses.length)}, but some interview emails failed.`)
      } else if (!screeningEffective) {
        toast.success(`Approved ${plural(responses.length)} — interview links sent`)
      } else {
        toast.success(`Approved ${plural(responses.length)}`)
      }
      if (!screeningEffective && responses.length > 0) {
        navigateAfterScreeningSkipped(jobId, navigate, queryClient)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
      setApprovingAll(false)
    }
  }

  const handleRejectAll = async () => {
    const toReject = confirmedTargets('rejected')
    if (toReject.length === 0) return
    setRejectingAll(true)
    try {
      const settled = await Promise.allSettled(
        toReject.map((r) => api.patch(`/api/shortlist/${r.id}/decision`, { hr_decision: 'rejected' })),
      )
      const done = settled.filter((o) => o.status === 'fulfilled').length
      const failed = settled.length - done
      const plural = (n: number) => `${n} candidate${n !== 1 ? 's' : ''}`
      if (failed > 0) {
        toast.error(
          done > 0
            ? `Rejected ${plural(done)}, but ${failed} could not be updated. The list has been refreshed.`
            : 'Could not reject. The list has been refreshed.',
        )
      } else {
        toast.success(`Rejected ${plural(done)}`)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['rejected', jobId] })
      setRejectingAll(false)
    }
  }

  const confirmBulk = async () => {
    const decision = bulkConfirm?.decision
    if (!decision) return
    if (decision === 'approved') await handleApproveAll()
    else await handleRejectAll()
    setBulkConfirm(null)
  }

  const aiShortlistedCandidates = scoredResults.filter(
    (result) => result.recommendation === 'shortlisted',
  )
  const exportBaseName = slugifyFilename(jobTitle ?? 'job')

  const handleExportShortlistedCsv = () => {
    if (aiShortlistedCandidates.length === 0) {
      toast('No resume-screened candidates to export.')
      return
    }
    const csv = buildShortlistCsv(aiShortlistedCandidates, requiredSkills)
    downloadTextFile(
      `${exportBaseName}-ai-shortlisted-${exportTimestamp()}.csv`,
      csv,
      'text/csv;charset=utf-8',
    )
    toast.success(
      `Exported ${aiShortlistedCandidates.length} candidate${aiShortlistedCandidates.length !== 1 ? 's' : ''} as CSV`,
    )
  }

  const handleExportShortlistedReports = async () => {
    if (exportingPdf) return
    if (aiShortlistedCandidates.length === 0) {
      toast('No resume-screened candidates to export.')
      return
    }
    const size = checkBundleSize(aiShortlistedCandidates.length)
    if (!size.ok) {
      toast.error(size.message)
      return
    }
    setExportingPdf(true)
    // A large export is laid out on the main thread, so the page can pause for a few seconds.
    const notice = size.slow
      ? toast.loading(`Preparing ${aiShortlistedCandidates.length} reports. This page may pause for a few seconds.`)
      : null
    try {
      // Loaded on demand: the PDF library and its fonts are not part of the page.
      const { downloadShortlistBundle } = await import('@/lib/pdf')
      await downloadShortlistBundle(aiShortlistedCandidates, requiredSkills, { jobTitle })
      toast.success(
        `Downloaded PDF with ${aiShortlistedCandidates.length} report${aiShortlistedCandidates.length !== 1 ? 's' : ''}`,
      )
    } catch {
      toast.error('Failed to generate PDF export')
    } finally {
      if (notice) toast.dismiss(notice)
      setExportingPdf(false)
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading || (isFetching && !results)) {
    return <ShortlistTableSkeleton />
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return <BackendError onRetry={refetch} />
  }

  // ── Nothing to decide ─────────────────────────────────────────────────────
  if (scoredResults.length === 0) {
    return (
      <div className={SHORTLIST_EMPTY_STATE_CLASS}>
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-3">
          <Users className="h-6 w-6 text-ink-subtle" />
        </div>
        <p className="mb-1 font-semibold text-ink">
          {allScored.length === 0 ? 'No candidates have been scored yet.' : 'No one is waiting for a decision.'}
        </p>
        {allScored.length > 0 && (
          <p className="max-w-sm text-sm text-ink-muted">
            Approved candidates are in Phone screening or Interviews, and rejected ones in Rejected.
          </p>
        )}
      </div>
    )
  }

  // ── Results ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <StageToolbar
        actions={
          <>
            {filteredScored.length !== scoredResults.length && (
              <p className="whitespace-nowrap text-sm text-ink-muted">
                Showing{' '}
                <span className="font-mono font-semibold tabular-nums text-ink">{filteredScored.length}</span>
                {' '}of{' '}
                <span className="font-mono font-semibold tabular-nums text-ink">{scoredResults.length}</span>
              </p>
            )}
            <BulkActionButtons
              approveLabel="Approve passed"
              rejectLabel="Reject failed"
              approvingAll={approvingAll}
              rejectingAll={rejectingAll}
              onApproveAll={() => requestBulk('approved')}
              onRejectAll={() => requestBulk('rejected')}
            />
            <MenuButton
              label="Export"
              icon={exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              disabled={aiShortlistedCandidates.length === 0 || exportingPdf}
              items={[
                {
                  label: `Export CSV (${aiShortlistedCandidates.length})`,
                  icon: <Download size={14} />,
                  onClick: handleExportShortlistedCsv,
                },
                {
                  label: exportingPdf ? 'Preparing PDF…' : 'Export all PDFs',
                  icon: <FileText size={14} />,
                  onClick: handleExportShortlistedReports,
                },
              ]}
            />
          </>
        }
      >
        <StageSearch value={search} onChange={setSearch} />
        <select
          value={recommendationFilter}
          onChange={(e) => setRecommendationFilter(e.target.value as RecommendationFilter)}
          aria-label="Filter by recommendation"
          className={SHORTLIST_FILTER_SELECT_CLASS}
        >
          {RECOMMENDATION_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </StageToolbar>

      {filteredScored.length === 0 ? (
        <div className={SHORTLIST_EMPTY_STATE_CLASS}>
          <p className="text-slate-400 text-sm">
            {scoredResults.length === 0
              ? 'No scored candidates yet.'
              : search || recommendationFilter !== 'all'
                ? 'No candidates match your filters.'
                : 'No results found.'}
          </p>
        </div>
      ) : (
        <ShortlistTable
          results={filteredScored}
          jobId={jobId}
          requiredSkills={requiredSkills}
          jobTitle={jobTitle}
          voiceScreeningEnabled={voiceScreeningEnabled}
        />
      )}

      {bulkConfirm && (
        <BulkDecisionDialog
          decision={bulkConfirm.decision}
          names={bulkConfirm.names}
          screeningEffective={screeningEffective}
          busy={approvingAll || rejectingAll}
          onConfirm={() => void confirmBulk()}
          onClose={() => setBulkConfirm(null)}
        />
      )}
    </div>
  )
}

export default ShortlistTab
