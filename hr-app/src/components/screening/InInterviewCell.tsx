import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { BTN_STAGE_LINK } from '@/components/ui/Surface'
import type { StageView } from '@/lib/shortlistDecision'

/**
 * What a Phone screening row shows once an interview (or finalist status) owns the candidate:
 * where they are, and a button to that stage's page. Shared by the pending/flagged rows and the
 * Completed list so the two cannot drift apart.
 */
export function InInterviewCell({ view, jobId }: { view: StageView | null; jobId: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {view && (
        <span className="text-[13px] text-ink-muted">
          {view.title} · {view.detail}
        </span>
      )}
      <Link to={view?.to ?? `/jobs/${jobId}/interviews`} className={BTN_STAGE_LINK}>
        {view?.toLabel ?? 'Open Interviews'}
        <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  )
}

/** The status pill for such a row: a finalist is a Finalist, anyone else is in interview. */
export function inInterviewBadge(view: StageView | null): { label: string; variant: 'completed' | 'active' } {
  return view?.phase === 'finalist'
    ? { label: 'Finalist', variant: 'completed' }
    : { label: 'In interview', variant: 'active' }
}
