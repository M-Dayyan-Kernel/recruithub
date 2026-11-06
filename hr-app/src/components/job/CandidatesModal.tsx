import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, Download, Info, Loader2, Mail, Minus, Phone, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { PipelineCandidate, PipelineCandidatesResponse, PipelineSort, PipelineStageKey } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BackendError } from '@/components/BackendError'
import { StageSearch } from '@/components/stage/StageToolbar'
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { PIPELINE_PAGE_SIZE, usePipelineCandidates } from '@/hooks/usePipelineCandidates'
import { fetchCandidateProfile } from '@/lib/candidates'
import { buildCandidateSteps, type StepState } from '@/lib/candidateSteps'
import {
  describePipelineCandidate,
  PIPELINE_STAGE_LABEL,
  PIPELINE_STAGE_ORDER,
  type StageTone,
} from '@/lib/pipelineStages'
import { buildPipelineCsv } from '@/lib/pipelineExport'
import { downloadTextFile, exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'
import { initialsOf, timeAgo } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

// The dot beside a stage. Only a verdict gets a colour (a finalist, a rejection, a failure); the
// working stages share one neutral dot, since green, amber and red mean status (docs/UI.md §2).
const STAGE_DOT: Record<PipelineStageKey, string> = {
  processing: 'bg-ink-subtle',
  failed: 'bg-neg',
  resume: 'bg-ink-subtle',
  phone: 'bg-ink-subtle',
  interview: 'bg-ink-subtle',
  finalist: 'bg-pos',
  rejected: 'bg-neg',
}

const TONE_TEXT: Record<StageTone, string> = {
  neutral: 'text-ink',
  accent: 'text-ink',
  pos: 'text-pos',
  warn: 'text-warn',
  neg: 'text-neg',
}

const SORT_OPTIONS: Array<{ value: PipelineSort; label: string }> = [
  { value: 'match', label: 'Match score' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name' },
]

const STEP_NODE: Record<StepState, string> = {
  done: 'border-ink bg-ink text-surface',
  current: 'border-ink bg-surface text-ink ring-2 ring-line-strong',
  skipped: 'border-line-strong bg-surface text-ink-subtle',
  upcoming: 'border-line bg-surface text-ink-subtle',
}

/** Where a candidate is in the four steps, and what each produced. Loaded when a row is opened. */
function StepTracker({ candidate }: { candidate: PipelineCandidate }) {
  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['candidate-profile', candidate.candidate_id],
    queryFn: () => fetchCandidateProfile(candidate.candidate_id),
  })
  const { steps, outcome } = buildCandidateSteps(candidate.stage, profile)

  return (
    <div>
      <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
        {steps.map((step, i) => (
          <li key={step.key} className="min-w-0">
            <div className="flex items-center">
              <span
                aria-hidden
                className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold', STEP_NODE[step.state])}
              >
                {step.state === 'done' ? <Check size={13} /> : step.state === 'skipped' ? <Minus size={13} /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className={cn('ml-1 h-px flex-1', step.state === 'done' || step.state === 'skipped' ? 'bg-ink' : 'bg-line')} />
              )}
            </div>
            <p className={cn('mt-1.5 text-[12px] font-medium', step.state === 'upcoming' ? 'text-ink-subtle' : 'text-ink')}>
              {step.label}
              <span className="sr-only"> ({step.state})</span>
            </p>
            <p className="min-h-[1rem] text-[11px] leading-snug text-ink-muted">
              {isLoading && step.state !== 'upcoming' ? '…' : step.detail}
            </p>
          </li>
        ))}
      </ol>
      {outcome && (
        <p className="mt-3 inline-flex rounded-md bg-neg-soft px-2 py-1 text-[12px] font-medium text-neg">
          {outcome === 'rejected' ? 'Rejected at this step' : candidate.failure_reason ?? 'The resume review failed'}
        </p>
      )}
      {isError && <p className="mt-2 text-[12px] text-ink-muted">Some details could not be loaded.</p>}
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-ink-muted"
    >
      {initialsOf(name)}
    </span>
  )
}

/** The match percentage and a bar for it. Colour is the verdict: strong, middling or weak. */
function MatchScore({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-ink-subtle">—</span>
  const tone = score >= 70 ? 'bg-pos text-pos' : score >= 50 ? 'bg-warn text-warn' : 'bg-neg text-neg'
  const [fill, text] = tone.split(' ')
  return (
    <span className="flex items-center gap-2.5">
      <span className={cn('w-9 font-mono text-sm font-semibold tabular-nums', text)}>{Math.round(score)}%</span>
      <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full', fill)} style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
      </span>
    </span>
  )
}

function CandidateRow({
  candidate,
  open,
  onToggle,
}: {
  candidate: PipelineCandidate
  open: boolean
  onToggle: () => void
}) {
  const view = describePipelineCandidate(candidate)
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn('cursor-pointer border-t border-line transition-colors hover:bg-surface-2', open && 'bg-surface-2/60')}
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={candidate.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{candidate.name}</p>
              <p className="truncate text-[12px] text-ink-muted">{candidate.email ?? 'No email on file'}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-ink">
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', STAGE_DOT[candidate.stage])} />
            {view.label}
          </span>
        </td>
        <td className={cn('hidden px-3 py-3 text-[13px] md:table-cell', TONE_TEXT[view.tone])}>
          {view.detail}
          {view.at && <span className="font-mono tabular-nums">, {view.at}</span>}
        </td>
        <td className="hidden px-3 py-3 sm:table-cell">
          <MatchScore score={candidate.match_score} />
        </td>
        <td className="hidden whitespace-nowrap px-3 py-3 text-[12px] text-ink-muted lg:table-cell">
          {timeAgo(candidate.updated_at)}
        </td>
        <td className="w-10 px-3 py-3 text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${candidate.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronDown size={16} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-2/60">
          <td colSpan={6} className="px-5 pb-4 pt-1">
            <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
              <StepTracker candidate={candidate} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {candidate.email && (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-surface-3 px-2.5 py-1.5 text-[12px] text-ink">
                      <Mail size={13} aria-hidden className="shrink-0 text-ink-muted" />
                      <span className="truncate">{candidate.email}</span>
                    </span>
                  )}
                  {candidate.phone && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2.5 py-1.5 text-[12px] text-ink">
                      <Phone size={13} aria-hidden className="shrink-0 text-ink-muted" />
                      {candidate.phone}
                    </span>
                  )}
                  {!candidate.email && !candidate.phone && (
                    <span className="text-[12px] text-ink-muted">No contact details on file</span>
                  )}
                </div>
                <Link to={`/candidates/${candidate.candidate_id}`} className={BTN_PRIMARY}>
                  View profile
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Every candidate on the job and the one stage each is in. Look-only on purpose: approving,
 * calling, scheduling and moving stage live on each stage's page and on the candidate's own page
 * ("View profile"), so every action has a single home.
 */
export function CandidatesModal({ jobId, jobTitle, onClose }: { jobId: string; jobTitle: string; onClose: () => void }) {
  const [stage, setStage] = useState<PipelineStageKey | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PipelineSort>('match')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const q = useDebouncedValue(search, 250)

  // A new search, stage or sort starts again at the first page, with nothing open.
  useEffect(() => {
    setPage(0)
    setOpenId(null)
  }, [stage, q, sort])

  const { data, isLoading, isError, refetch } = usePipelineCandidates(jobId, {
    stage,
    q,
    sort,
    offset: page * PIPELINE_PAGE_SIZE,
  })

  const counts = data?.counts
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined
  const pages = data ? Math.max(1, Math.ceil(data.total / PIPELINE_PAGE_SIZE)) : 1
  const from = data && data.total > 0 ? page * PIPELINE_PAGE_SIZE + 1 : 0
  const to = data ? Math.min(data.total, (page + 1) * PIPELINE_PAGE_SIZE) : 0

  const exportCsv = async () => {
    setExporting(true)
    try {
      // Everything under the current stage and search, up to the server's page cap of 200.
      const params = new URLSearchParams({ limit: '200', offset: '0', sort })
      if (stage) params.set('stage', stage)
      if (q.trim()) params.set('q', q.trim())
      const out = (await api.get(`/api/jobs/${jobId}/pipeline-candidates?${params}`)) as unknown as PipelineCandidatesResponse
      downloadTextFile(`${slugifyFilename(jobTitle)}-candidates-${exportTimestamp()}.csv`, buildPipelineCsv(out.items), 'text/csv;charset=utf-8')
      toast.success(
        out.total > out.items.length
          ? `Exported the first ${out.items.length} of ${out.total} candidates`
          : `Exported ${out.items.length} candidate${out.items.length === 1 ? '' : 's'}`,
      )
    } catch {
      toast.error('Could not export the candidates')
    } finally {
      setExporting(false)
    }
  }

  const tab = (selected: boolean) =>
    cn(
      '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
      selected ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
    )
  const countBadge = (selected: boolean) =>
    cn(
      'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
      selected ? 'bg-ink text-surface' : 'bg-surface-3 text-ink-muted',
    )

  return createPortal(
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Users size={18} aria-hidden className="text-ink-muted" />
          Candidates
          {all !== undefined && (
            <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-ink-muted">{all}</span>
          )}
        </span>
      }
      description={jobTitle}
      headerActions={
        <button type="button" onClick={() => void exportCsv()} disabled={exporting || !all} className={BTN_SECONDARY}>
          {exporting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
          Export
        </button>
      }
      onClose={onClose}
      size="2xl"
      blur
    >
      <div className="flex gap-1 overflow-x-auto border-b border-line px-5" role="group" aria-label="Filter by stage">
        <button type="button" onClick={() => setStage(null)} aria-pressed={stage === null} className={tab(stage === null)}>
          All
          {all !== undefined && <span className={countBadge(stage === null)}>{all}</span>}
        </button>
        {PIPELINE_STAGE_ORDER.filter((key) => (counts?.[key] ?? 0) > 0 || key === stage).map((key) => (
          <button key={key} type="button" onClick={() => setStage(key)} aria-pressed={stage === key} className={tab(stage === key)}>
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', STAGE_DOT[key])} />
            {PIPELINE_STAGE_LABEL[key]}
            <span className={countBadge(stage === key)}>{counts?.[key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <StageSearch value={search} onChange={setSearch} placeholder="Search name or email" />
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as PipelineSort)}
            className="h-9 rounded-lg border border-line bg-surface py-0 pl-3 pr-8 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isError ? (
        <div className="p-5">
          <BackendError onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="space-y-px px-5 pb-5" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="px-5 py-14 text-center text-sm text-ink-muted">
          {q.trim() || stage ? 'No candidates match.' : 'No candidates on this job yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th scope="col" className="px-5 pb-2 pt-1 font-semibold">Candidate</th>
                <th scope="col" className="px-3 pb-2 pt-1 font-semibold">Stage</th>
                <th scope="col" className="hidden px-3 pb-2 pt-1 font-semibold md:table-cell">Status</th>
                <th scope="col" className="hidden px-3 pb-2 pt-1 font-semibold sm:table-cell">Match</th>
                <th scope="col" className="hidden px-3 pb-2 pt-1 font-semibold lg:table-cell">Updated</th>
                <th scope="col" className="w-10 px-3 pb-2 pt-1"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((candidate) => (
                <CandidateRow
                  key={candidate.candidate_id}
                  candidate={candidate}
                  open={openId === candidate.candidate_id}
                  onToggle={() => setOpenId((id) => (id === candidate.candidate_id ? null : candidate.candidate_id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info size={13} aria-hidden />
          One stage per candidate
        </span>
        <span className="inline-flex items-center gap-3">
          {data && data.total > 0 && (
            <span>
              Showing <span className="font-mono font-semibold tabular-nums text-ink">{from}–{to}</span> of{' '}
              <span className="font-mono font-semibold tabular-nums text-ink">{data.total}</span>
            </span>
          )}
          {pages > 1 && (
            <span className="inline-flex gap-1.5">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={BTN_SECONDARY}>
                Previous
              </button>
              <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={BTN_SECONDARY}>
                Next
              </button>
            </span>
          )}
        </span>
      </div>
    </Modal>,
    document.body,
  )
}
