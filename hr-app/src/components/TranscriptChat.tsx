import { useMemo } from 'react'
import { parseTranscript } from '@/lib/transcript'

const SPEAKER_LABEL = {
  ai: 'Interviewer',
  candidate: 'Candidate',
} as const

interface TranscriptChatProps {
  transcript: string
  /** Tailwind max-height class, e.g. max-h-96 */
  maxHeightClass?: string
  aiLabel?: string
  candidateLabel?: string
}

export default function TranscriptChat({
  transcript,
  maxHeightClass = 'max-h-96',
  aiLabel = SPEAKER_LABEL.ai,
  candidateLabel = SPEAKER_LABEL.candidate,
}: TranscriptChatProps) {
  const turns = useMemo(() => parseTranscript(transcript), [transcript])

  if (turns.length === 0) return null

  return (
    <div
      className={`overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-3 ${maxHeightClass}`}
    >
      <div className="space-y-3">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                turn.speaker === 'ai'
                  ? 'rounded-bl-md bg-indigo-50 text-indigo-950 ring-1 ring-indigo-100'
                  : turn.speaker === 'candidate'
                    ? 'rounded-br-md bg-white text-slate-800 ring-1 ring-slate-200'
                    : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
              }`}
            >
              {turn.speaker !== 'unknown' && (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {turn.speaker === 'ai' ? aiLabel : candidateLabel}
                </p>
              )}
              <p className="whitespace-pre-wrap">{turn.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
