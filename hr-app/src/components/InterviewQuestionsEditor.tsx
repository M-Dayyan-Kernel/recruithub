import { Plus, Trash2, ListChecks } from 'lucide-react'
import type { InterviewQuestion } from '@/types/api'

interface Props {
  questions: InterviewQuestion[]
  onChange: (questions: InterviewQuestion[]) => void
  disabled?: boolean
  embedded?: boolean
}

const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 disabled:text-slate-500'

function newQuestion(): InterviewQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
    score: 10,
  }
}

export function InterviewQuestionsEditor({ questions, onChange, disabled, embedded }: Props) {
  const totalScore = questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0)

  const updateQuestion = (id: string, patch: Partial<InterviewQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const removeQuestion = (id: string) => {
    onChange(questions.filter((q) => q.id !== id))
  }

  const addQuestion = () => {
    onChange([...questions, newQuestion()])
  }

  return (
    <div className="space-y-4">
      {!embedded && (
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
          >
            <Plus size={13} />
            Add question
          </button>
        </div>
      )}

      {embedded && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addQuestion}
            disabled={disabled}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
          >
            <Plus size={13} />
            Add question
          </button>
        </div>
      )}

      {questions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
            <ListChecks size={18} />
          </div>
          <p className="text-sm text-slate-600">No questions yet</p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            Upload a JD to generate questions automatically, or add them manually.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {questions.map((q, index) => (
            <div
              key={q.id}
              className="group rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_72px_32px] sm:items-start">
                <div>
                  <label
                    htmlFor={`question-${q.id}`}
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    Question {index + 1}
                  </label>
                  <textarea
                    id={`question-${q.id}`}
                    rows={2}
                    value={q.question}
                    onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                    disabled={disabled}
                    placeholder="What should the interviewer ask?"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`score-${q.id}`}
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    Points
                  </label>
                  <input
                    id={`score-${q.id}`}
                    type="number"
                    min={1}
                    value={q.score}
                    onChange={(e) =>
                      updateQuestion(q.id, { score: Math.max(1, Number(e.target.value) || 1) })
                    }
                    disabled={disabled}
                    className={fieldClass}
                  />
                </div>
                <div className="flex justify-end sm:pt-6">
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.id)}
                    disabled={disabled}
                    title="Remove question"
                    aria-label={`Remove question ${index + 1}`}
                    className="rounded-lg p-2 text-slate-400 opacity-60 transition-all hover:bg-white hover:text-rose-500 hover:opacity-100 hover:shadow-sm disabled:opacity-50 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {questions.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white px-4 py-2.5">
          <span className="text-xs text-slate-500">Total rubric score</span>
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-indigo-700">
            {totalScore}
          </span>
        </div>
      )}
    </div>
  )
}
