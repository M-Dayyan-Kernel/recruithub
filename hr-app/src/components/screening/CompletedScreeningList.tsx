import { useMemo, useState } from 'react'
import type { ScreeningRow } from '@/components/screening/screeningRows'
import { ScreeningCallDetails } from '@/components/screening/ScreeningCallDetails'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'

export function CompletedScreeningList({
  rows,
  jobId,
}: {
  rows: ScreeningRow[]
  jobId: string
}) {
  const candidateIds = useMemo(() => rows.map((r) => r.candidateId), [rows])
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})

  const isExpanded = (id: string) => expandedMap[id] ?? false

  const expandAll = () => {
    setExpandedMap(Object.fromEntries(candidateIds.map((id) => [id, true])))
  }

  const collapseAll = () => {
    setExpandedMap(Object.fromEntries(candidateIds.map((id) => [id, false])))
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-slate-500">No completed screenings yet.</p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-slate-500">
          {rows.length} completed
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={expandAll}
            className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            <ChevronsUpDown size={11} />
            All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            <ChevronsDownUp size={11} />
            None
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
        {rows.map((row) =>
          row.latestCall ? (
            <ScreeningCallDetails
              key={row.candidateId}
              call={row.latestCall}
              jobId={jobId}
              attemptNumber={row.attemptNumber}
              candidateName={row.candidateName}
              phone={row.phone}
              variant="card"
              collapsible
              listItem={!isExpanded(row.candidateId)}
              expanded={isExpanded(row.candidateId)}
              onExpandedChange={(open) =>
                setExpandedMap((prev) => ({ ...prev, [row.candidateId]: open }))
              }
            />
          ) : null,
        )}
      </div>
    </div>
  )
}
