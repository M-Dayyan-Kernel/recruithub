import { useState } from 'react'
import { Check, ChevronDown, ListChecks, Minus, Quote } from 'lucide-react'
import type { InterviewQuestionScore } from '@/types/api'

/**
 * The rubric, one collapsible card per question.
 *
 * Each card carries the expected answer - the points the assessor was looking
 * for - marked covered or missed, so a reviewer can see *why* a question scored
 * what it did rather than just the number.
 */

/** A soft tint per card, cycled by position, to break up a long list. */
const TINTS = [
  {
    badge: 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white',
    open: 'bg-gradient-to-br from-indigo-50 via-white to-white',
    ring: 'ring-indigo-200',
  },
  {
    badge: 'bg-gradient-to-br from-violet-500 to-violet-600 text-white',
    open: 'bg-gradient-to-br from-violet-50 via-white to-white',
    ring: 'ring-violet-200',
  },
  {
    badge: 'bg-gradient-to-br from-sky-500 to-sky-600 text-white',
    open: 'bg-gradient-to-br from-sky-50 via-white to-white',
    ring: 'ring-sky-200',
  },
  {
    badge: 'bg-gradient-to-br from-teal-500 to-teal-600 text-white',
    open: 'bg-gradient-to-br from-teal-50 via-white to-white',
    ring: 'ring-teal-200',
  },
  {
    badge: 'bg-gradient-to-br from-amber-500 to-amber-600 text-white',
    open: 'bg-gradient-to-br from-amber-50 via-white to-white',
    ring: 'ring-amber-200',
  },
  {
    badge: 'bg-gradient-to-br from-rose-500 to-rose-600 text-white',
    open: 'bg-gradient-to-br from-rose-50 via-white to-white',
    ring: 'ring-rose-200',
  },
]

function coverage(qs: InterviewQuestionScore) {
  const pc = qs.point_coverage ?? []
  return { covered: pc.filter((p) => p.covered).length, total: pc.length }
}

function ExpectedAnswer({ qs }: { qs: InterviewQuestionScore }) {
  const pc = qs.point_coverage ?? []

  // Fall back to the bare expected_points when coverage has not been computed.
  const points = pc.length
    ? pc
    : (qs.expected_points ?? []).map((point) => ({ point, covered: false as boolean | null }))

  if (points.length === 0) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
        The expected-answer checklist is still being prepared for this question.
      </p>
    )
  }

  const scored = pc.length > 0

  return (
    <div>
      <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <ListChecks size={13} />
        Expected answer {scored ? '· covered vs missed' : '· not yet assessed'}
      </p>
      <ul className="space-y-2">
        {points.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
                !scored
                  ? 'bg-slate-100 text-slate-400'
                  : item.covered
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-rose-100 text-rose-500'
              }`}
            >
              {!scored ? (
                <Minus size={11} strokeWidth={3} />
              ) : item.covered ? (
                <Check size={11} strokeWidth={3} />
              ) : (
                <Minus size={11} strokeWidth={3} />
              )}
            </span>
            <span
              className={`text-[13px] leading-relaxed ${
                scored && !item.covered ? 'text-slate-500' : 'text-slate-700'
              }`}
            >
              {item.point}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuestionCard({
  qs,
  index,
  open,
  onToggle,
}: {
  qs: InterviewQuestionScore
  index: number
  open: boolean
  onToggle: () => void
}) {
  const tint = TINTS[index % TINTS.length]
  const { covered, total } = coverage(qs)
  const earned = qs.earned_score ?? 0
  const pct = qs.score > 0 ? (earned / qs.score) * 100 : 0

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-all duration-200 ${
        open
          ? `border-transparent shadow-[0_4px_20px_-6px_rgba(15,23,42,0.12)] ring-1 ${tint.ring} ${tint.open}`
          : 'border-slate-200 bg-gradient-to-b from-white to-slate-50/60 hover:shadow-[0_2px_10px_-4px_rgba(15,23,42,0.1)]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold shadow-sm ${tint.badge}`}
        >
          {index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-snug text-slate-800">
            {qs.question}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-600">
              {earned}/{qs.score} points
            </span>
            {total > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  covered === 0
                    ? 'bg-rose-50 text-rose-600'
                    : covered === total
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-amber-50 text-amber-600'
                }`}
              >
                {covered}/{total} covered
              </span>
            )}
          </span>
          {/* Score bar, so the list scans without expanding anything */}
          <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <span
              className={`block h-1 rounded-full ${
                pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-400'
              }`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </span>
        </span>

        <ChevronDown
          size={16}
          className={`mt-1 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/70 px-4 pb-4 pt-4">
          <ExpectedAnswer qs={qs} />

          {qs.candidate_answer?.trim() && (
            <div>
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Quote size={12} />
                What the candidate said
              </p>
              <p className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-white/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-600 backdrop-blur-sm">
                {qs.candidate_answer}
              </p>
            </div>
          )}

          {qs.notes && (
            <p className="rounded-xl border border-slate-100 bg-white/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-600 backdrop-blur-sm">
              <span className="font-semibold text-slate-700">Assessor note — </span>
              {qs.notes}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function QuestionAccordion({
  questions,
}: {
  questions: InterviewQuestionScore[]
}) {
  // First question open, so the shape of a card is obvious without a click.
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set([0]))

  const allOpen = openIds.size === questions.length
  const toggleAll = () =>
    setOpenIds(allOpen ? new Set() : new Set(questions.map((_, i) => i)))

  const toggleOne = (i: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  if (questions.length === 0) {
    return <p className="text-sm text-slate-400">No rubric questions were recorded.</p>
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-slate-500">
          {questions.length} question{questions.length === 1 ? '' : 's'} · expand one to see the
          expected answer
        </p>
        <button
          type="button"
          onClick={toggleAll}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="space-y-2.5">
        {questions.map((qs, i) => (
          <QuestionCard
            key={qs.id || i}
            qs={qs}
            index={i}
            open={openIds.has(i)}
            onToggle={() => toggleOne(i)}
          />
        ))}
      </div>
    </div>
  )
}
