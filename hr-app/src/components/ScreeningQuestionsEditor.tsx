import { useState, type ReactNode } from 'react'
import { Lock, MessageCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { ScreeningQuestion, ScreeningQuestionKind } from '@/types/api'
import { Badge } from '@/components/ui/Surface'
import { KIND_BADGES, questionKind, remainingQuestionSlots } from '@/lib/screeningQuestions'
import { SCREENING_QUESTIONS_MAX_TOTAL, SCREENING_QUESTION_MAX_LENGTH } from '@/lib/validation'

interface Props {
  /** The locked questions the server builds. Shown first, never editable. */
  standard: ScreeningQuestion[]
  /** The role-specific and custom questions, which HR can edit, remove and add to. */
  questions: ScreeningQuestion[]
  onChange: (questions: ScreeningQuestion[]) => void
  /** Total questions on a call, the standard ones included. */
  maxTotal?: number
  /** Per role or custom question. */
  maxChars?: number
  disabled?: boolean
  /** Cap visible rows; extra questions scroll inside the list. */
  scrollable?: boolean
  /** Leave out the title and explanation, for a modal that already has them. */
  compact?: boolean
  appearance?: 'default' | 'panel'
}

const fieldClass =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-surface-2 disabled:text-ink-muted'

/** Highlights a row whose question text is still blank, which blocks saving. */
const emptyFieldClass = 'border-neg focus:border-neg'

export function createScreeningQuestion(): ScreeningQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
    kind: 'custom',
  }
}

const KIND_ICONS: Record<ScreeningQuestionKind, ReactNode> = {
  standard: <Lock size={11} aria-hidden />,
  role: <Sparkles size={11} aria-hidden />,
  custom: <Pencil size={11} aria-hidden />,
}

/**
 * What a question is: a label and an icon as well as a colour, so the category never depends on
 * colour alone. Only the role-specific badge uses the accent (there are at most two of them).
 */
function KindBadge({ kind }: { kind: ScreeningQuestionKind }) {
  const { label, tone, outlined } = KIND_BADGES[kind]
  const content = (
    <>
      {KIND_ICONS[kind]}
      {label}
    </>
  )
  if (outlined) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
        {content}
      </span>
    )
  }
  return <Badge tone={tone}>{content}</Badge>
}

export function ScreeningQuestionsEditor({
  standard,
  questions,
  onChange,
  maxTotal = SCREENING_QUESTIONS_MAX_TOTAL,
  maxChars = SCREENING_QUESTION_MAX_LENGTH,
  disabled,
  scrollable,
  compact,
  appearance = 'default',
}: Props) {
  const panel = appearance === 'panel'
  const [expanded, setExpanded] = useState(false)
  const total = standard.length + questions.length
  const slots = remainingQuestionSlots(standard.length, questions.length, maxTotal)
  const atCap = slots === 0

  const updateQuestion = (id: string, patch: Partial<ScreeningQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    onChange(questions.filter((q) => q.id !== id))
  }

  const addQuestion = () => {
    if (!atCap) {
      setExpanded(true)
      onChange([...questions, createScreeningQuestion()])
    }
  }

  return (
    <div className={panel ? "overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" : "space-y-3"}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${panel ? "border-b border-line px-5 py-5 sm:px-6" : ""}`}>
        {!compact ? (
          <div>
            <p className="text-sm font-semibold text-ink">Screening questions</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              What the AI voice agent asks during phone screening. Standard questions are fixed.
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Standard questions are fixed.</p>
        )}
        <div className="flex shrink-0 items-center gap-3">
          <span
            className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[11px] tabular-nums text-ink-muted"
            aria-live="polite"
            data-testid="screening-question-count"
          >
            {total} of {maxTotal}
          </span>
          <button
            type="button"
            onClick={addQuestion}
            disabled={disabled || atCap}
            title={atCap ? `A call can have at most ${maxTotal} questions` : undefined}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} />
            Add question
          </button>
        </div>
      </div>

      <ol
        className={
          panel ? 'space-y-3 p-3 sm:p-4' : scrollable
            ? 'scrollbar-thin-light max-h-[20rem] space-y-2 overflow-y-auto pr-1.5'
            : 'space-y-2'
        }
      >
        {(panel && !expanded ? standard.slice(0, 6) : standard).map((q, index) => (
          <li
            key={q.id}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3 py-4 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]"
          >
            <span className="w-5 shrink-0 pt-0.5 text-center font-mono text-xs tabular-nums text-ink-subtle">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{q.question}</p>
            <span className="col-start-2 sm:col-start-auto"><KindBadge kind="standard" /></span>
          </li>
        ))}

        {(panel && !expanded ? questions.slice(0, Math.max(0, 6 - standard.length)) : questions).map((q, index) => {
          const kind = questionKind(q)
          const position = standard.length + index + 1
          const blank = !q.question.trim()
          return (
            <li
              key={q.id}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3 py-4 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]"
            >
              <span className="w-5 shrink-0 pt-2 text-center font-mono text-xs tabular-nums text-ink-subtle">
                {position}
              </span>
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={q.question}
                  onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                  disabled={disabled}
                  maxLength={maxChars}
                  placeholder="Screening question…"
                  aria-label={`Question ${position}`}
                  aria-invalid={blank}
                  className={`${fieldClass} ${blank ? emptyFieldClass : ''}`}
                />
                {q.question.length >= maxChars * 0.8 && (
                  <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                    {q.question.length}/{maxChars}
                  </p>
                )}
              </div>
              <div className="col-start-2 flex shrink-0 items-center gap-1 pt-1 sm:col-start-auto">
                <KindBadge kind={kind} />
                <button
                  type="button"
                  onClick={() => removeQuestion(q.id)}
                  disabled={disabled}
                  title="Remove"
                  aria-label={`Remove question ${position}`}
                  className="rounded p-1 text-ink-subtle transition-colors hover:bg-neg-soft hover:text-neg disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      {panel && total > 6 && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
          className="w-full border-t border-line bg-surface-2 px-4 py-3 text-xs font-medium text-ink-muted hover:bg-accent-soft hover:text-accent">
          {expanded ? 'Show fewer questions' : `Show ${total - 6} more questions`}
        </button>
      )}
      {questions.length === 0 && (
        <div className={`flex items-center gap-3 rounded-lg border border-dashed border-line bg-surface-2 px-3 py-3 ${panel ? "m-4" : ""}`}>
          <MessageCircle size={16} className="shrink-0 text-ink-subtle" aria-hidden />
          <p className="text-xs text-ink-muted">
            No role-specific questions yet. You can add up to {slots} more.
          </p>
        </div>
      )}
    </div>
  )
}
