import { Puzzle } from 'lucide-react'
import type {
  ExtensionCheckStamp,
  IntegrityFlaggedExtension,
  IntegritySummary,
  IntegrityTimelineEntry,
} from '@/types/integrity'
import { Badge, Card, type Tone } from '@/components/ui/Surface'
import { describeSignal } from '@/lib/integritySignals'
import {
  EXTENSION_CHECK_OFF_MESSAGE,
  POLICY_UNAVAILABLE_MESSAGE,
  extensionCheckState,
} from '@/lib/extensionCheckState'

/**
 * Browser-extension evidence for one interview.
 *
 * Deliberately plain: facts and where they came from, never a verdict. The scan
 * ran on the candidate's own machine, so it is evidence for a person to weigh.
 * It is not an input to the interview score.
 */

const REASON_LABEL: Record<string, string> = {
  known_id: 'On the known AI-assistant list',
  heuristic_strong: 'Strong match: looks like an AI assistant that can read the page or hear audio',
  heuristic_weak: 'Weak match: AI-related wording only',
}

const PHASE_LABEL: Record<string, string> = {
  preflight: 'Pre-flight check',
  final: 'Final readiness check',
  start: 'At interview start',
}

const OUTCOME_TONE: Record<string, Tone> = {
  clear: 'pos',
  flagged: 'warn',
  blocked: 'neg',
  unavailable: 'neutral',
}

const OUTCOME_LABEL: Record<string, string> = {
  clear: 'Clear',
  flagged: 'Flagged',
  blocked: 'Blocked',
  unavailable: 'Could not be checked',
}

function ExtensionRow({ ext }: { ext: IntegrityFlaggedExtension }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-semibold text-ink">{ext.name}</p>
        {ext.blocked ? (
          <Badge tone="neg">Blocked the start</Badge>
        ) : ext.would_block ? (
          <Badge tone="warn">Would block when enforcing</Badge>
        ) : (
          <Badge tone="neutral">Flagged</Badge>
        )}
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">
        {REASON_LABEL[ext.reason_code] ?? ext.reason_code}
      </p>
      {ext.signals.length > 0 && (
        <p className="mt-1 text-[12px] text-ink-subtle">
          {ext.signals.map(describeSignal).join(' · ')}
        </p>
      )}
      <p className="mt-1 text-[11px] text-ink-subtle">
        First seen at: {PHASE_LABEL[ext.first_seen_phase] ?? ext.first_seen_phase} · seen in{' '}
        {ext.seen_in_scans} {ext.seen_in_scans === 1 ? 'check' : 'checks'}
      </p>
    </li>
  )
}

function TimelineRow({ entry }: { entry: IntegrityTimelineEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
      <span className="w-40 shrink-0 tabular-nums text-ink-subtle">
        {new Date(entry.at).toLocaleString()}
      </span>
      <span className="w-44 shrink-0">{PHASE_LABEL[entry.phase] ?? entry.phase}</span>
      <Badge tone={OUTCOME_TONE[entry.outcome] ?? 'neutral'}>
        {OUTCOME_LABEL[entry.outcome] ?? entry.outcome}
      </Badge>
      {entry.flagged_count > 0 && <span>{entry.flagged_count} flagged</span>}
    </li>
  )
}

export default function ExtensionSignals({
  summary,
  stamp,
}: {
  summary: IntegritySummary | null | undefined
  stamp?: ExtensionCheckStamp | null
}) {
  const state = extensionCheckState(summary, stamp)

  // Nothing on record for an interview that predates the check: say nothing, as before.
  if (state === 'not_recorded' || !summary) return null

  if (state === 'off') {
    return (
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-ink-subtle" aria-hidden />
          <h3 className="text-[15px] font-semibold text-ink">Browser extension checks</h3>
          <Badge tone="neutral">Off</Badge>
        </div>
        <p className="text-[13px] text-ink-muted">{EXTENSION_CHECK_OFF_MESSAGE}</p>
      </Card>
    )
  }

  const { flagged_extensions: flagged } = summary

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Puzzle className="h-4 w-4 text-accent" aria-hidden />
        <h3 className="text-[15px] font-semibold text-ink">Browser extension checks</h3>
        <Badge tone={OUTCOME_TONE[summary.latest_outcome] ?? 'neutral'}>
          Latest: {OUTCOME_LABEL[summary.latest_outcome] ?? summary.latest_outcome}
        </Badge>
      </div>

      {state === 'unavailable' ? (
        <p className="mb-3 text-[13px] text-ink">{POLICY_UNAVAILABLE_MESSAGE}</p>
      ) : summary.note ? (
        <p className="mb-3 text-[13px] text-ink">{summary.note}</p>
      ) : (
        <p className="mb-3 text-[13px] text-ink-muted">
          No AI-related extensions were detected across {summary.scans}{' '}
          {summary.scans === 1 ? 'check' : 'checks'}.
        </p>
      )}

      {summary.was_ever_blocked && (
        <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
          The candidate was stopped by this check at least once before the interview began.
        </p>
      )}
      {summary.unavailable_scans > 0 && (
        <p className="mb-3 text-[12px] text-ink-muted">
          {summary.unavailable_scans} {summary.unavailable_scans === 1 ? 'check' : 'checks'} could
          not be completed (for example the extension did not respond). Those are not a clean result.
        </p>
      )}

      {flagged.length > 0 && (
        <ul className="mb-4 space-y-2" aria-label="Flagged extensions">
          {flagged.map((ext) => (
            <ExtensionRow key={ext.id} ext={ext} />
          ))}
        </ul>
      )}

      <details className="group">
        <summary className="cursor-pointer text-[12px] font-medium text-ink-muted hover:text-ink">
          Check history ({summary.timeline.length})
        </summary>
        <ul className="mt-2 space-y-1.5">
          {summary.timeline.map((entry, index) => (
            <TimelineRow key={`${entry.at}-${index}`} entry={entry} />
          ))}
        </ul>
      </details>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
        These checks run in the candidate&rsquo;s browser and show which extensions were enabled, not
        whether any were used. Treat them as a prompt to review the recording, not as a conclusion.
        They do not affect the interview score.
      </p>
    </Card>
  )
}
