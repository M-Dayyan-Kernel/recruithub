import { cn } from '@/lib/utils'

/** A ring for the resume match score: the arc is the percentage, its colour is the verdict. */
export function MatchRing({ score, size = 64 }: { score: number; size?: number }) {
  const value = Math.max(0, Math.min(100, score))
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const colour = value >= 70 ? 'stroke-pos' : value >= 50 ? 'stroke-warn' : 'stroke-neg'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(value)} percent match`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-line-strong" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          className={cn('transition-[stroke-dashoffset]', colour)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-base font-semibold tabular-nums text-ink">
        {Math.round(value)}
      </span>
    </div>
  )
}
