import { WORKFLOW_CARD_CLASS, WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

const COLUMNS = ['Name', 'Match Score', 'AI Recommendation', 'HR Status', 'Actions'] as const
const TH_CLASS =
  'px-6 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500'

export function ShortlistTableSkeleton() {
  return (
    <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
      <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="h-7 w-32 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
        <thead className="bg-slate-50">
          <tr>
            <th className="w-10 px-4 py-3 text-center">
              <div className="mx-auto h-4 w-4 animate-pulse rounded bg-slate-200" />
            </th>
            {COLUMNS.map((col) => (
              <th key={col} className={TH_CLASS}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {[1, 2, 3, 4, 5].map((index) => (
            <tr key={index} className="animate-pulse">
              <td className="px-4 py-3 text-center">
                <div className="mx-auto h-4 w-4 rounded bg-slate-200" />
              </td>
              <td className="px-6 py-3 text-center">
                <div className="mx-auto h-3.5 w-28 rounded bg-slate-200" />
              </td>
              <td className="px-6 py-3 text-center">
                <div className="mx-auto h-5 w-12 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3 text-center">
                <div className="mx-auto h-5 w-14 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3 text-center">
                <div className="mx-auto h-5 w-16 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3 text-center">
                <div className="mx-auto flex w-fit gap-2">
                  <div className="h-7 w-14 rounded-lg bg-slate-100" />
                  <div className="h-7 w-16 rounded-lg bg-slate-100" />
                  <div className="h-7 w-14 rounded-lg bg-slate-100" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
