import { useState, type ComponentType } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Briefcase,
  Calendar,
  ChevronDown,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ScreeningCall } from '@/types/api'

function formatCallDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function humanizeEndedReason(reason: string): string {
  return reason
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const RESULT_STYLES: Record<
  NonNullable<ScreeningCall['result']>,
  { label: string; badge: string; ring: string }
> = {
  pass: {
    label: 'Passed',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    ring: 'border-emerald-200 bg-emerald-50/60',
  },
  fail: {
    label: 'Failed',
    badge: 'bg-rose-100 text-rose-800 border-rose-200',
    ring: 'border-rose-200 bg-rose-50/60',
  },
  needs_review: {
    label: 'Needs Review',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    ring: 'border-amber-200 bg-amber-50/60',
  },
}

const QUALITY_STYLES: Record<string, string> = {
  excellent: 'bg-emerald-100 text-emerald-800',
  good: 'bg-blue-100 text-blue-800',
  fair: 'bg-amber-100 text-amber-800',
  poor: 'bg-rose-100 text-rose-800',
}

function DetailCard({
  icon: Icon,
  label,
  value,
  className = '',
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  label: string
  value?: string | null
  className?: string
}) {
  if (!value?.trim()) return null
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm ${className}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Icon size={13} className="shrink-0" />
        {label}
      </div>
      <p className="text-sm font-medium leading-snug text-slate-800">{value}</p>
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  )
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-medium text-slate-500">HR decision</span>
      <button
        type="button"
        onClick={() => mutation.mutate('pass')}
        disabled={mutation.isPending}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          call.result === 'pass'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
        }`}
      >
        {mutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
        Pass
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate('fail')}
        disabled={mutation.isPending}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          call.result === 'fail'
            ? 'border-rose-600 bg-rose-600 text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:text-rose-700'
        }`}
      >
        {mutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
        Fail
      </button>
    </div>
  )
}

export function ScreeningCallDetails({
  call,
  jobId,
  attemptNumber,
}: {
  call: ScreeningCall
  jobId: string
  attemptNumber?: number
}) {
  const [showTranscript, setShowTranscript] = useState(false)

  if (call.call_status !== 'completed') return null

  const resultStyle = call.result ? RESULT_STYLES[call.result] : null
  const willingness =
    call.willingness_to_proceed === true
      ? { label: 'Interested', className: 'bg-emerald-100 text-emerald-800' }
      : call.willingness_to_proceed === false
        ? { label: 'Not interested', className: 'bg-rose-100 text-rose-800' }
        : { label: 'Unclear', className: 'bg-slate-100 text-slate-600' }

  const hasScreeningFields =
    call.availability ||
    call.employment_status ||
    call.relevant_experience ||
    call.notice_period ||
    call.location_preference ||
    call.communication_quality

  const hasCompensation = call.current_ctc || call.expected_ctc

  return (
    <div
      className={`rounded-xl border p-4 sm:p-5 ${
        resultStyle?.ring ?? 'border-slate-200 bg-white'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {resultStyle && (
              <span
                className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${resultStyle.badge}`}
              >
                {resultStyle.label}
              </span>
            )}
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${willingness.className}`}
            >
              {willingness.label}
            </span>
            {attemptNumber != null && (
              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                Attempt #{attemptNumber}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Screened {formatCallDate(call.created_at)}
            {call.ended_reason && (
              <span className="text-slate-400"> · {humanizeEndedReason(call.ended_reason)}</span>
            )}
          </p>
        </div>
        <HrDecisionButtons call={call} jobId={jobId} />
      </div>

      {/* AI Summary */}
      {call.summary && (
        <div className="mt-4">
          <SectionHeader title="AI summary" subtitle="High-level takeaways from the conversation" />
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p className="text-sm leading-relaxed text-slate-700">{call.summary}</p>
          </div>
        </div>
      )}

      {/* Screening responses */}
      {hasScreeningFields && (
        <div className="mt-5">
          <SectionHeader title="Screening responses" subtitle="Structured answers captured during the call" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailCard icon={Calendar} label="Availability" value={call.availability} />
            <DetailCard icon={Briefcase} label="Employment status" value={call.employment_status} />
            <DetailCard icon={Clock} label="Notice period" value={call.notice_period} />
            <DetailCard icon={MapPin} label="Location preference" value={call.location_preference} />
            <DetailCard
              icon={MessageSquare}
              label="Relevant experience"
              value={call.relevant_experience}
              className="sm:col-span-2 lg:col-span-3"
            />
            {call.communication_quality && (
              <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Phone size={13} />
                  Communication
                </div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                    QUALITY_STYLES[call.communication_quality] ?? 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {call.communication_quality}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compensation */}
      {hasCompensation && (
        <div className="mt-5">
          <SectionHeader title="Compensation" />
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailCard icon={DollarSign} label="Current CTC" value={call.current_ctc} />
            <DetailCard icon={DollarSign} label="Expected CTC" value={call.expected_ctc} />
          </div>
        </div>
      )}

      {/* Empty extraction state */}
      {!hasScreeningFields && !hasCompensation && !call.summary && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
          <User className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No structured fields extracted</p>
          <p className="mt-1 text-xs text-slate-400">
            Review the transcript below or update the HR decision manually.
          </p>
        </div>
      )}

      {/* Transcript */}
      {call.transcript && (
        <div className="mt-5 border-t border-slate-200/80 pt-4">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="inline-flex items-center gap-2">
              <FileText size={16} className="text-indigo-500" />
              Full call transcript
            </span>
            <ChevronDown
              size={16}
              className={`text-slate-400 transition-transform ${showTranscript ? 'rotate-180' : ''}`}
            />
          </button>
          {showTranscript && (
            <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">
                {call.transcript}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
