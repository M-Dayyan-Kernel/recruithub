import { Sparkles, Target } from 'lucide-react'

/**
 * Strengths / areas to improve.
 *
 * Each point gets its own row rather than sitting in a run of paragraphs, so a
 * card with one finding and a card with four read as the same kind of list.
 */

const TONES = {
  positive: {
    Icon: Sparkles,
    title: 'Strengths',
    edge: 'from-emerald-200/70 via-teal-100/50 to-emerald-100/40',
    wash: 'from-emerald-50/80 via-white to-white',
    chip: 'from-emerald-400 to-teal-500 shadow-emerald-500/30',
    label: 'text-emerald-700',
    pill: 'bg-emerald-100 text-emerald-700',
    marker: 'from-emerald-400 to-teal-500',
    glow: 'bg-emerald-400/15',
    empty: 'Nothing was flagged as a strength in this interview.',
  },
  negative: {
    Icon: Target,
    title: 'Areas to improve',
    edge: 'from-rose-200/70 via-orange-100/50 to-rose-100/40',
    wash: 'from-rose-50/80 via-white to-white',
    chip: 'from-rose-400 to-pink-500 shadow-rose-500/30',
    label: 'text-rose-700',
    pill: 'bg-rose-100 text-rose-700',
    marker: 'from-rose-400 to-pink-500',
    glow: 'bg-rose-400/15',
    empty: 'No concerns were raised in this interview.',
  },
} as const

export type InsightTone = keyof typeof TONES

export default function InsightCard({
  tone,
  items,
  title,
}: {
  tone: InsightTone
  items: string[]
  /** Overrides the default heading. */
  title?: string
}) {
  const t = TONES[tone]
  const { Icon } = t

  return (
    <div className="relative">
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-4 -top-6 h-28 w-28 rounded-full blur-3xl ${t.glow}`}
      />

      <div className={`relative h-full rounded-2xl bg-gradient-to-br p-px ${t.edge}`}>
        <div
          className={`flex h-full flex-col rounded-[15px] bg-gradient-to-br p-5 ${t.wash}`}
        >
          {/* Header */}
          <div className="mb-4 flex items-center gap-2.5">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${t.chip}`}
            >
              <Icon size={15} />
            </span>
            <h3
              className={`text-[12px] font-bold uppercase tracking-wide ${t.label}`}
            >
              {title ?? t.title}
            </h3>
            {items.length > 0 && (
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${t.pill}`}
              >
                {items.length}
              </span>
            )}
          </div>

          {/* Points */}
          {items.length === 0 ? (
            <p className="text-[13px] italic text-slate-400">{t.empty}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 rounded-xl border border-white/70 bg-white/70 px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] backdrop-blur-sm"
                >
                  <span
                    className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br ${t.marker}`}
                  />
                  <span className="text-[13px] leading-relaxed text-slate-700">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
