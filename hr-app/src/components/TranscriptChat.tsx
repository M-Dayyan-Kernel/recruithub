import { useMemo } from 'react'
import { parseTranscript, segmentsToTurns } from '@/lib/transcript'
import type { TranscriptSegment } from '@/lib/transcript'

const SPEAKER_LABEL = {
  ai: 'Interviewer',
  candidate: 'Candidate',
} as const

interface TranscriptChatProps {
  transcript: string
  segments?: TranscriptSegment[]
  currentTimeSec?: number
  onTurnClick?: (startSec: number) => void
  /** Tailwind max-height class, e.g. max-h-96 */
  maxHeightClass?: string
  aiLabel?: string
  candidateLabel?: string
}

export default function TranscriptChat({
  transcript,
  segments,
  currentTimeSec,
  onTurnClick,
  maxHeightClass = 'max-h-96',
  aiLabel = SPEAKER_LABEL.ai,
  candidateLabel = SPEAKER_LABEL.candidate,
}: TranscriptChatProps) {
  const turns = useMemo(() => {
    if (segments && segments.length > 0) {
      return segmentsToTurns(segments)
    }
    return parseTranscript(transcript)
  }, [segments, transcript])

  if (turns.length === 0) return null

  const isSynced = Boolean(onTurnClick && segments && segments.length > 0)

  return (
    <div
      className={`overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-3 ${maxHeightClass}`}
    >
      <div className="space-y-3">
        {turns.map((turn, i) => {
          const isActive =
            isSynced &&
            currentTimeSec != null &&
            turn.start_sec != null &&
            turn.end_sec != null &&
            currentTimeSec >= turn.start_sec &&
            currentTimeSec < turn.end_sec

          const isClickable = isSynced && turn.start_sec != null

          return (
            <div
              key={i}
              className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}
            >
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => {
                  if (isClickable && turn.start_sec != null) {
                    onTurnClick?.(turn.start_sec)
                  }
                }}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed shadow-sm transition-colors ${
                  turn.speaker === 'ai'
                    ? 'rounded-bl-md bg-indigo-50 text-indigo-950 ring-1 ring-indigo-100'
                    : turn.speaker === 'candidate'
                      ? 'rounded-br-md bg-white text-slate-800 ring-1 ring-slate-200'
                      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                } ${
                  isActive
                    ? 'ring-2 ring-indigo-400 ring-offset-1'
                    : ''
                } ${
                  isClickable
                    ? 'cursor-pointer hover:ring-2 hover:ring-indigo-200'
                    : 'cursor-default'
                }`}
              >
                {turn.speaker !== 'unknown' && (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {turn.speaker === 'ai' ? aiLabel : candidateLabel}
                  </p>
                )}
                <p className="whitespace-pre-wrap">{turn.text}</p>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
