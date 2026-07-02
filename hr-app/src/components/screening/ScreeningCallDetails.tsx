import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronDown, FileText, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { ScreeningCall } from '@/types/api'

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-slate-500">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  )
}

const QUALITY_COLORS: Record<string, string> = {
  excellent: 'text-emerald-700',
  good: 'text-blue-700',
  fair: 'text-amber-700',
  poor: 'text-rose-700',
}

function HrDecisionButtons({ call, jobId }: { call: ScreeningCall; jobId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (result: NonNullable<ScreeningCall['result']>) =>
      api.patch(`/api/screening/${call.id}/result`, { result }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      toast.success('Screening decision updated')
    },
    onError: () => toast.error('Failed to update screening decision'),
  })

  if (call.call_status !== 'completed') return null

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => mutation.mutate('pass')}
        disabled={mutation.isPending}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
          call.result === 'pass'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-200 text-slate-500 hover:border-emerald-300'
        }`}
      >
        Approve Pass
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate('fail')}
        disabled={mutation.isPending}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
          call.result === 'fail'
            ? 'border-rose-600 bg-rose-600 text-white'
            : 'border-slate-200 text-slate-500 hover:border-rose-300'
        }`}
      >
        Reject Fail
      </button>
    </div>
  )
}

export function ScreeningCallDetails({
  call,
  jobId,
}: {
  call: ScreeningCall
  jobId: string
}) {
  const [showSummary, setShowSummary] = useState(true)
  const [showTranscript, setShowTranscript] = useState(false)

  if (call.call_status !== 'completed') return null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FieldRow label="Availability" value={call.availability} />
        <FieldRow label="Notice Period" value={call.notice_period} />
        <FieldRow label="Current CTC" value={call.current_ctc} />
        <FieldRow label="Expected CTC" value={call.expected_ctc} />
        <FieldRow label="Location" value={call.location_preference} />
        <FieldRow label="Experience" value={call.relevant_experience} />
        {call.communication_quality && (
          <div>
            <p className="mb-0.5 text-xs font-medium text-slate-500">Communication</p>
            <p
              className={`text-sm font-medium capitalize ${QUALITY_COLORS[call.communication_quality] ?? 'text-slate-700'}`}
            >
              {call.communication_quality}
            </p>
          </div>
        )}
      </div>

      {call.summary && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowSummary((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600"
          >
            <ChevronDown size={14} className={showSummary ? 'rotate-180' : ''} />
            Summary
          </button>
          {showSummary && (
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{call.summary}</p>
          )}
        </div>
      )}

      {call.transcript && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600"
          >
            <FileText size={14} />
            {showTranscript ? 'Hide Transcript' : 'Show Transcript'}
          </button>
          {showTranscript && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">
              {call.transcript}
            </pre>
          )}
        </div>
      )}

      <HrDecisionButtons call={call} jobId={jobId} />
    </div>
  )
}
