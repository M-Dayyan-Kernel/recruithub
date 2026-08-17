import { Plus, Trash2, MessageCircle } from 'lucide-react'
import type { ScreeningQuestion } from '@/types/api'

interface Props {
  questions: ScreeningQuestion[]
  onChange: (questions: ScreeningQuestion[]) => void
  disabled?: boolean
  embedded?: boolean
  /** Cap visible rows; extra questions scroll inside the list */
  scrollable?: boolean
  hideHeader?: boolean
}

const fieldClass =
  'w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 disabled:text-slate-500'

/** Highlights a row whose question text is still blank, which blocks saving. */
const emptyFieldClass = 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/15'

export function createScreeningQuestion(): ScreeningQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
  }
}

export function ScreeningQuestionsEditor({
  questions,
  onChange,
  disabled,
  embedded,
  scrollable,
  hideHeader,
}: Props) {
  const updateQuestion = (id: string, patch: Partial<ScreeningQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    onChange(questions.filter((q) => q.id !== id))
  }

  const addQuestion = () => {
    onChange([...questions, createScreeningQuestion()])
  }

  if (embedded) {
    return (
      <div className="space-y-2">
        {questions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4">
            <MessageCircle size={16} className="shrink-0 text-slate-400" />
            <p className="text-xs text-slate-500">
              No questions yet — defaults apply or add questions manually.
            </p>
          </div>
        ) : (
          <div
            className={`overflow-hidden rounded-lg border border-slate-200 ${
              scrollable ? 'scrollbar-thin-light max-h-[15.5rem] overflow-y-auto' : ''
            }`}
          >
            <table className="w-full">
              <thead>
                <tr
                  className={`border-b border-slate-100 bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${
                    scrollable ? 'sticky top-0 z-10 backdrop-blur-sm' : ''
                  }`}
                >
                  <th className="w-9 px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Question</th>
                  <th className="w-8 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {questions.map((q, index) => (
                  <tr key={q.id} className="group hover:bg-slate-50/60">
                    <td className="px-2 py-1.5 text-center text-xs font-medium tabular-nums text-slate-400">
                      {index + 1}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={q.question}
                        onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                        disabled={disabled}
                        placeholder="Screening question…"
                        aria-label={`Question ${index + 1}`}
                        aria-invalid={!q.question.trim()}
                        className={`${fieldClass} ${
                          q.question.trim() ? '' : emptyFieldClass
                        }`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.id)}
                        disabled={disabled}
                        title="Remove"
                        aria-label={`Remove question ${index + 1}`}
                        className="rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 group-hover:text-slate-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Screening questions</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Topics the AI voice agent will cover during phone screening.
            </p>
          </div>
          <button
            type="button"
            onClick={addQuestion}
            disabled={disabled}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
          >
            <Plus size={12} />
            Add question
          </button>
        </div>
      )}

      {questions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
          <MessageCircle size={16} className="mb-1.5 text-slate-400" />
          <p className="text-xs text-slate-500">No questions yet</p>
        </div>
      ) : (
        <div
          className={
            scrollable
              ? 'scrollbar-thin-light max-h-[15.5rem] space-y-2 overflow-y-auto pr-1.5'
              : 'space-y-2'
          }
        >
          {questions.map((q, index) => (
            <div
              key={q.id}
              className="grid grid-cols-[1fr_28px] items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/40 px-2 py-1.5"
            >
              <input
                type="text"
                value={q.question}
                onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                disabled={disabled}
                placeholder={`Question ${index + 1}…`}
                aria-label={`Question ${index + 1}`}
                aria-invalid={!q.question.trim()}
                className={`${fieldClass} ${q.question.trim() ? '' : emptyFieldClass}`}
              />
              <button
                type="button"
                onClick={() => removeQuestion(q.id)}
                disabled={disabled}
                aria-label={`Remove question ${index + 1}`}
                className="rounded p-1 text-slate-400 hover:text-rose-500 disabled:opacity-50"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
