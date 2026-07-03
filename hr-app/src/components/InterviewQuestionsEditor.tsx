import { Plus, Trash2, ListChecks } from 'lucide-react'
import type { InterviewQuestion } from '@/types/api'

interface Props {
  questions: InterviewQuestion[]
  onChange: (questions: InterviewQuestion[]) => void
  disabled?: boolean
  embedded?: boolean
  hideTotal?: boolean
}

const fieldClass =
  'w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 disabled:text-slate-500'

const scoreInputClass = `${fieldClass} w-14 min-w-[3.5rem] shrink-0 px-1.5 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`

function parseScoreInput(raw: string): number {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return 1
  return Math.max(1, parseInt(digits, 10))
}

export function createInterviewQuestion(): InterviewQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
    score: 10,
  }
}

export function InterviewQuestionsEditor({
  questions,
  onChange,
  disabled,
  embedded,
  hideTotal,
}: Props) {
  const totalScore = questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0)

  const updateQuestion = (id: string, patch: Partial<InterviewQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    onChange(questions.filter((q) => q.id !== id))
  }

  const addQuestion = () => {
    onChange([...questions, createInterviewQuestion()])
  }

  if (embedded) {
    return (
      <div className="space-y-2">
        {questions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4">
            <ListChecks size={16} className="shrink-0 text-slate-400" />
            <p className="text-xs text-slate-500">
              No questions yet — upload a JD or add questions manually.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="w-9 px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Question</th>
                  <th className="w-16 px-1 py-1.5 text-center">Pts</th>
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
                        placeholder="Interview question…"
                        aria-label={`Question ${index + 1}`}
                        className={fieldClass}
                      />
                    </td>
                    <td className="w-16 px-1 py-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={q.score}
                        onChange={(e) =>
                          updateQuestion(q.id, { score: parseScoreInput(e.target.value) })
                        }
                        disabled={disabled}
                        aria-label={`Points for question ${index + 1}`}
                        className={scoreInputClass}
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

        {!hideTotal && questions.length > 0 && (
          <div className="flex justify-end">
            <span className="text-[11px] text-slate-400">
              Total{' '}
              <span className="font-semibold tabular-nums text-indigo-600">{totalScore}</span> pts
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Interview rubric</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Questions the AI interviewer will ask, with point weights.
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

      {questions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
          <ListChecks size={16} className="mb-1.5 text-slate-400" />
          <p className="text-xs text-slate-500">No questions yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map((q, index) => (
            <div
              key={q.id}
              className="grid grid-cols-[1fr_64px_28px] items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/40 px-2 py-1.5"
            >
              <input
                type="text"
                value={q.question}
                onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                disabled={disabled}
                placeholder={`Question ${index + 1}…`}
                aria-label={`Question ${index + 1}`}
                className={fieldClass}
              />
              <input
                type="text"
                inputMode="numeric"
                value={q.score}
                onChange={(e) =>
                  updateQuestion(q.id, { score: parseScoreInput(e.target.value) })
                }
                disabled={disabled}
                aria-label={`Points for question ${index + 1}`}
                className={scoreInputClass}
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

      {questions.length > 0 && (
        <div className="flex justify-end text-[11px] text-slate-400">
          Total <span className="ml-1 font-semibold tabular-nums text-indigo-600">{totalScore}</span>{' '}
          pts
        </div>
      )}
    </div>
  )
}
