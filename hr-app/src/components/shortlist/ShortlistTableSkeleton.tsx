import { WORKFLOW_CARD_CLASS, WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

export function ShortlistTableSkeleton() {
  return (
    <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
      <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
        <thead className="bg-slate-50">
          <tr>
            {['Name', 'Email', 'Match Score', 'AI Recommendation', 'HR Status', 'Actions'].map(
              (col) => (
                <th
                  key={col}
                  className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {col}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {[1, 2, 3, 4, 5].map((index) => (
            <tr key={index} className="animate-pulse">
              <td className="px-6 py-3">
                <div className="h-3.5 w-28 rounded bg-slate-200" />
              </td>
              <td className="px-6 py-3">
                <div className="h-3 w-36 rounded bg-slate-100" />
              </td>
              <td className="px-6 py-3">
                <div className="h-5 w-12 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3">
                <div className="h-5 w-14 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3">
                <div className="h-5 w-16 rounded-full bg-slate-100" />
              </td>
              <td className="px-6 py-3">
                <div className="flex gap-2">
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
