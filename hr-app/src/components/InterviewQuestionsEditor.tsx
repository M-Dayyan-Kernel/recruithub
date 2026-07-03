import { Plus, Trash2 } from 'lucide-react'
import type { InterviewQuestion } from '@/types/api'

interface Props {
  questions: InterviewQuestion[]
  onChange: (questions: InterviewQuestion[]) => void
  disabled?: boolean
}

function newQuestion(): InterviewQuestion {
  return {
    id: crypto.randomUUID(),
    question: '',
    score: 10,
  }
}

export function InterviewQuestionsEditor({ questions, onChange, disabled }: Props) {
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-700">Interview Questions</label>
        <button
          type="button"
          onClick={addQuestion}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
        >
          <Plus size={12} />
          Add question
        </button>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
          No interview questions yet. Upload a JD to auto-generate, or add questions manually.
        </p>
      ) : (
        <div className="space-y-2">
          {questions.map((q, index) => (
            <div
              key={q.id}
              className="grid grid-cols-[1fr_88px_36px] items-start gap-2 rounded-lg border border-slate-200 p-2.5"
            >
              <div>
                <p className="mb-1 text-xs font-medium text-slate-400">Q{index + 1}</p>
                <textarea
                  rows={2}
                  value={q.question}
                  onChange={(e) => updateQuestion(q.id, { question: e.target.value })}
                  disabled={disabled}
                  placeholder="Question to ask in the interview..."
                  className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-400">Score</p>
                <input
                  type="number"
                  min={1}
                  value={q.score}
                  onChange={(e) =>
                    updateQuestion(q.id, { score: Math.max(1, Number(e.target.value) || 1) })
                  }
                  disabled={disabled}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
                />
              </div>
              <div className="flex justify-end pt-5">
                <button
                  type="button"
                  onClick={() => removeQuestion(q.id)}
                  disabled={disabled}
                  title="Remove question"
                  aria-label={`Remove question ${index + 1}`}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-500">Overall score:</span>
        <span className="ml-2 font-semibold text-slate-800">{totalScore}</span>
      </div>
    </div>
  )
}
