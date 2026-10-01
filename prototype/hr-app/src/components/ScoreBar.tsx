// Default-export ScoreBar — used by InterviewReport page
// value: 0-10 scale

export default function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 10) * 100
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="flex items-center gap-3">
      <span className="w-40 text-sm text-zinc-600 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-sm font-semibold text-zinc-700">{value}/10</span>
    </div>
  )
}
