import { Link } from 'react-router-dom'
import type { CandidateListItem } from '@/types/api'
import { displayOrNa, formatHiringStage } from '@/lib/candidates'
import { formatUploadedAt } from '@/lib/workflow'
import { Card } from '@/components/ui/Surface'
import { Table, Tbody, Td, Th, Thead, Tr, useColumnWidths } from '@/components/ui/DataTable'
import { cn } from '@/lib/utils'

interface Props {
  items: CandidateListItem[]
  onRowClick: (id: string) => void
}

function stageBadgeClass(stage: string): string {
  if (stage === 'Hired' || stage === 'Finalist') return 'bg-pos-soft text-pos'
  if (stage === 'Rejected' || stage === 'Failed') return 'bg-neg-soft text-neg'
  if (stage === 'Processing' || stage === 'Screening' || stage === 'Interview') {
    return 'bg-accent-soft text-accent'
  }
  return 'bg-surface-3 text-ink-muted'
}

/** id, label, default width. Order is the column order. */
const COLUMNS = [
  { id: 'name', label: 'Name', w: 180 },
  { id: 'email', label: 'Email', w: 220 },
  { id: 'phone', label: 'Phone', w: 140 },
  { id: 'job', label: 'Job', w: 200 },
  { id: 'exp', label: 'Experience', w: 110 },
  { id: 'ctc', label: 'Current CTC', w: 120 },
  { id: 'ectc', label: 'Expected CTC', w: 130 },
  { id: 'notice', label: 'Notice', w: 110 },
  { id: 'stage', label: 'Stage', w: 130 },
  { id: 'match', label: 'Match', w: 90 },
  { id: 'status', label: 'Status', w: 120 },
  { id: 'applied', label: 'Applied', w: 130 },
] as const

export function CandidatesTable({ items, onRowClick }: Props) {
  const { widths, onPointerDown, reset } = useColumnWidths('candidates')

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="text-[11px] text-ink-subtle">
          Drag a column edge to resize. Hover a clipped cell to read it in full.
        </p>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 text-[11px] font-semibold text-ink-muted transition-colors hover:text-accent"
        >
          Reset widths
        </button>
      </div>

      <Table>
        <Thead>
          <tr>
            {COLUMNS.map((c) => (
              <Th key={c.id} id={c.id} width={widths[c.id] ?? c.w} onResize={onPointerDown}>
                {c.label}
              </Th>
            ))}
          </tr>
        </Thead>
        <Tbody>
          {items.map((row) => (
            <Tr key={row.id} onClick={() => onRowClick(row.id)}>
              <Td className="font-medium text-ink" title={row.name}>
                {row.name}
              </Td>
              <Td title={row.email ?? undefined}>
                {displayOrNa(row.email)}
              </Td>
              <Td title={row.phone ?? undefined}>
                {displayOrNa(row.phone)}
              </Td>
              <Td title={row.job_title ?? undefined}>
                <Link
                  to={`/jobs/${row.job_id}/shortlist?tab=results`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-accent hover:text-accent-hover"
                >
                  {row.job_title}
                </Link>
              </Td>
              <Td className="tabular-nums">
                {displayOrNa(row.years_experience)}
              </Td>
              <Td title={row.current_ctc ?? undefined}>{displayOrNa(row.current_ctc)}</Td>
              <Td title={row.expected_ctc ?? undefined}>{displayOrNa(row.expected_ctc)}</Td>
              <Td title={row.notice_period ?? undefined}>{displayOrNa(row.notice_period)}</Td>
              <Td truncate={false}>
                <span
                  className={cn(
                    'inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    stageBadgeClass(row.hiring_stage),
                  )}
                >
                  {formatHiringStage(row.hiring_stage)}
                </span>
              </Td>
              <Td className="tabular-nums">
                {row.match_score != null ? `${Math.round(row.match_score)}%` : 'N/A'}
              </Td>
              <Td className="capitalize" title={row.status.replace('_', ' ')}>
                {row.status.replace('_', ' ')}
              </Td>
              <Td title={formatUploadedAt(row.date_applied)}>
                {formatUploadedAt(row.date_applied)}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  )
}
