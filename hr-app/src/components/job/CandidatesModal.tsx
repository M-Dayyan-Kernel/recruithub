import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, Minus } from 'lucide-react'
import type { PipelineCandidate, PipelineStageKey } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BackendError } from '@/components/BackendError'
import { StageSearch } from '@/components/stage/StageToolbar'
import { BTN_SECONDARY } from '@/components/ui/Surface'
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
import { cn } from '@/lib/utils'

const TONE_DOT: Record<StageTone, string> = {
  neutral: 'bg-ink-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  neg: 'bg-neg',
}

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
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{candidate.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[view.tone])} />
            <span className="font-medium text-ink">{view.label}</span>
            <span className="truncate">
              · {view.detail}
              {view.at && <span className="font-mono tabular-nums">, {view.at}</span>}
            </span>
          </span>
        </span>
        {candidate.match_score != null && (
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
            {Math.round(candidate.match_score)}%
          </span>
        )}
        <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-surface-2/50 px-5 py-4">
          <StepTracker candidate={candidate} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="min-w-0 truncate text-[12px] text-ink-muted">
              {[candidate.email, candidate.phone].filter(Boolean).join(' · ') || 'No contact details on file'}
            </p>
            <Link to={`/candidates/${candidate.candidate_id}`} className={BTN_SECONDARY}>
              Open full profile
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Every candidate on the job and the one stage each is in. Look-only on purpose: approving,
 * calling and scheduling stay on each stage's page, so every action has a single home. Opening a
 * row shows the step tracker and a link to the full profile.
 */
export function CandidatesModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [stage, setStage] = useState<PipelineStageKey | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useDebouncedValue(search, 250)

  // A new search or stage starts again at the first page, with nothing open.
  useEffect(() => {
    setPage(0)
    setOpenId(null)
  }, [stage, q])

  const { data, isLoading, isError, refetch } = usePipelineCandidates(jobId, {
    stage,
    q,
    offset: page * PIPELINE_PAGE_SIZE,
  })

  const counts = data?.counts
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined
  const pages = data ? Math.max(1, Math.ceil(data.total / PIPELINE_PAGE_SIZE)) : 1

  const chip = (selected: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      selected ? 'border-line-strong bg-surface-3 text-ink' : 'border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink',
    )

  return createPortal(
    <Modal
      title="Candidates"
      description={all !== undefined ? `${all} on this job, each in the one stage they are in. Act on them from that stage's page.` : undefined}
      onClose={onClose}
      size="xl"
      blur
    >
      <div className="space-y-3 border-b border-line px-5 py-4">
        <StageSearch value={search} onChange={setSearch} placeholder="Search by name or email" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
          <button type="button" onClick={() => setStage(null)} aria-pressed={stage === null} className={chip(stage === null)}>
            All
            {all !== undefined && <span className="font-mono tabular-nums">{all}</span>}
          </button>
          {PIPELINE_STAGE_ORDER.filter((key) => (counts?.[key] ?? 0) > 0 || key === stage).map((key) => (
            <button key={key} type="button" onClick={() => setStage(key)} aria-pressed={stage === key} className={chip(stage === key)}>
              {PIPELINE_STAGE_LABEL[key]}
              <span className="font-mono tabular-nums">{counts?.[key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {isError ? (
        <div className="p-5">
          <BackendError onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="space-y-px p-5" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-ink-muted">
          {q.trim() || stage ? 'No candidates match.' : 'No candidates on this job yet.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {data?.items.map((candidate) => (
              <CandidateRow
                key={candidate.candidate_id}
                candidate={candidate}
                open={openId === candidate.candidate_id}
                onToggle={() => setOpenId((id) => (id === candidate.candidate_id ? null : candidate.candidate_id))}
              />
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-muted">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={BTN_SECONDARY}>
                Previous
              </button>
              <span>
                Page <span className="font-mono tabular-nums">{page + 1}</span> of <span className="font-mono tabular-nums">{pages}</span>
              </span>
              <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={BTN_SECONDARY}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Modal>,
    document.body,
  )
}
