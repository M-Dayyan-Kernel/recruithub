import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, AlertCircle, CircleGauge, Clock, Download, Eye, ListChecks, Loader2, MessageSquareText, ShieldAlert, Video } from 'lucide-react'
import { api } from '@/lib/api'
import type { InterviewReport } from '@/types/api'
import ProctoringPlayer, { isHard, parseTimestamp, toTimedFlags } from '@/components/interview/ProctoringPlayer'
import ProctoringSummary from '@/components/interview/ProctoringSummary'
import RadialScore from '@/components/interview/RadialScore'
import QuestionAccordion from '@/components/interview/QuestionAccordion'
import StatTile from '@/components/interview/StatTile'
import Tabs, { type TabDef } from '@/components/interview/Tabs'
import GlassCard from '@/components/interview/GlassCard'
import InsightCard from '@/components/interview/InsightCard'
import { downloadInterviewReportPdf } from '@/lib/interviewReportPdf'
import TranscriptChat from '@/components/TranscriptChat'
import { parseTranscript } from '@/lib/transcript'

// ---------------------------------------------------------------------------
// Rubric question card
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Recommendation badge
// ---------------------------------------------------------------------------

type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | string

function RecommendationBadge({ rec }: { rec: Recommendation | undefined }) {
  if (!rec) return null

  const cfg: Record<string, { label: string; className: string }> = {
    strong_hire: {
      label: 'Strong Hire',
      className:
        'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30',
    },
    hire: {
      label: 'Hire',
      className:
        'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/30',
    },
    hold: {
      label: 'Hold',
      className:
        'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30',
    },
    no_hire: {
      label: 'No Hire',
      className:
        'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/30',
    },
  }

  const { label, className } = cfg[rec] ?? {
    label: rec,
    className: 'bg-gradient-to-r from-slate-500 to-slate-600 text-white shadow-lg shadow-slate-500/25',
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ring-white/25 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ReportSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="h-7 bg-slate-200 rounded w-56 mb-3" />
        <div className="h-4 bg-slate-200 rounded w-40 mb-2" />
        <div className="h-8 bg-slate-100 rounded-full w-28" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="h-12 bg-slate-200 rounded-full w-24 mx-auto mb-6" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReportPage
// ---------------------------------------------------------------------------

export default function ReportPage() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>()
  const [searchParams] = useSearchParams()
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [tab, setTab] = useState<'overview' | 'questions' | 'integrity'>('overview')
  const audioRef = useRef<HTMLAudioElement>(null)

  const backToInterviews = useMemo(() => {
    if (!jobId) return '/'
    const params = new URLSearchParams()
    const tab = searchParams.get('tab') ?? 'completed'
    params.set('tab', tab)
    const search = searchParams.get('search')
    const page = searchParams.get('page')
    if (search) params.set('search', search)
    if (page) params.set('page', page)
    return `/jobs/${jobId}/interviews?${params.toString()}`
  }, [jobId, searchParams])

  // ── Report ────────────────────────────────────────────────────────────────
  const {
    data: report,
    isLoading,
    isError,
    error,
  } = useQuery<InterviewReport>({
    queryKey: ['report', candidateId],
    queryFn: () =>
      api.get(`/api/candidates/${candidateId}/report`) as unknown as Promise<InterviewReport>,
    enabled: !!candidateId,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 10_000
      const status = data.video_proctoring?.status
      if (status === 'queued' || status === 'started') return 10_000
      return false
    },
  })

  // ── 404 / not-ready detection ─────────────────────────────────────────────
  const isReportNotReady =
    isError &&
    (error?.message?.includes('404') ||
     error?.message?.toLowerCase().includes('not found') ||
     error?.message?.toLowerCase().includes('not ready'))

  const transcriptTurns = useMemo(
    () => (report?.transcript ? parseTranscript(report.transcript) : []),
    [report?.transcript],
  )

  // ── Proctoring ────────────────────────────────────────────────────────────
  const proctoring = report?.video_proctoring ?? null
  const timedFlags = useMemo(
    () => toTimedFlags(proctoring?.result?.flags),
    [proctoring?.result?.flags],
  )
  const hardCount = useMemo(() => timedFlags.filter((f) => isHard(f.severity)).length, [timedFlags])
  const softCount = timedFlags.length - hardCount
  const analysedDurationSec = useMemo(
    () => parseTimestamp(proctoring?.result?.duration),
    [proctoring?.result?.duration],
  )
  const isVideo = Boolean(report?.recording_url) && !report?.recording_key?.endsWith('.ogg')
  // The marked player owns its own seeking; keep a handle so transcript turns
  // can drive it too.
  const playerSeekRef = useRef<((sec: number) => void) | null>(null)
  const registerSeek = useCallback((fn: (sec: number) => void) => {
    playerSeekRef.current = fn
  }, [])

  const questions = report?.question_scores ?? []
  const totalEarned = questions.reduce((sum, q) => sum + (q.earned_score ?? 0), 0)
  const totalPossible = questions.reduce((sum, q) => sum + (q.score ?? 0), 0)

  const tabDefs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'questions', label: 'Questions', count: questions.length || null },
    {
      id: 'integrity',
      label: 'Integrity',
      count: hardCount + softCount || null,
      tone: hardCount > 0 ? 'danger' : 'default',
    },
  ]

  const activeCaption = useMemo(() => {
    const segs = report?.transcript_segments
    if (!segs?.length || currentTimeSec <= 0) return null
    const seg = segs.find((x) => currentTimeSec >= x.start_sec && currentTimeSec < x.end_sec)
    return seg?.text ?? null
  }, [report?.transcript_segments, currentTimeSec])

  const hasSyncedTranscript = Boolean(
    report?.recording_url &&
      report.transcript_segments &&
      report.transcript_segments.length > 0 &&
      report.transcript,
  )

  /** Video seeks through the marked player; audio through its own element. */
  const handleTurnClick = (startSec: number) => {
    if (isVideo) {
      playerSeekRef.current?.(startSec)
      return
    }
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = startSec
    void audio.play()
  }

  const handleMediaTimeUpdate = () => {
    if (audioRef.current) setCurrentTimeSec(audioRef.current.currentTime)
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 via-white to-slate-50/40">
      <div className="mx-auto max-w-6xl p-6">
      {/* Back link */}
      <Link
        to={backToInterviews}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Interviews
      </Link>

      {/* Loading */}
      {isLoading && <ReportSkeleton />}

      {/* 404 / Report not ready */}
      {isReportNotReady && (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-700 font-semibold text-lg mb-2">Report Not Ready Yet</p>
          <p className="text-slate-400 text-sm max-w-sm">
            The interview report isn't available yet. Check back after the interview completes.
          </p>
        </div>
      )}

      {/* Generic error */}
      {isError && !isReportNotReady && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          Failed to load report. Please try again.
        </div>
      )}

      {/* Report loaded */}
      {report && (
        <div className="space-y-6">
          {/* ── Recording and its transcript, side by side ────────────────── */}
          {report.recording_url && (
            <div
              className={`grid grid-cols-1 gap-5 ${
                hasSyncedTranscript ? 'lg:grid-cols-5' : ''
              }`}
            >
              <div className={hasSyncedTranscript ? 'lg:col-span-3' : ''}>
                {isVideo ? (
                  <ProctoringPlayer
                    src={report.recording_url}
                    flags={timedFlags}
                    fallbackDurationSec={analysedDurationSec}
                    currentTimeSec={currentTimeSec}
                    onTimeUpdate={setCurrentTimeSec}
                    onSeekRef={registerSeek}
                    candidateName={report.candidate_name}
                    caption={activeCaption}
                  />
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="mb-4 inline-flex items-center gap-2 text-base font-semibold text-slate-800">
                      <Video size={18} className="text-indigo-500" />
                      Interview Recording
                    </h2>
                    <audio
                      ref={audioRef}
                      controls
                      className="w-full"
                      src={report.recording_url}
                      preload="metadata"
                      onTimeUpdate={handleMediaTimeUpdate}
                    >
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}
              </div>

              {hasSyncedTranscript && (
                <div className="flex max-h-[38rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_10px_30px_-12px_rgba(15,23,42,0.12)] lg:col-span-2">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 to-transparent px-5 py-3.5">
                    <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <MessageSquareText size={16} className="text-indigo-500" />
                      Synced Transcript
                    </h2>
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
                      {transcriptTurns.length} messages
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
                    <TranscriptChat
                      transcript={report.transcript!}
                      segments={report.transcript_segments!}
                      currentTimeSec={currentTimeSec}
                      onTurnClick={handleTurnClick}
                      maxHeightClass="max-h-[32rem]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Header: who, which role, verdict, export ──────────────────── */}
          <GlassCard edge="brand" glow innerClassName="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {report.candidate_name ?? 'Interview Report'}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {report.job_title ?? 'Interview Assessment'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RecommendationBadge rec={report.final_recommendation} />
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={() => {
                  setDownloadingPdf(true)
                  try {
                    downloadInterviewReportPdf(report)
                    toast.success('Interview report downloaded')
                  } catch {
                    toast.error('Failed to generate PDF')
                  } finally {
                    setDownloadingPdf(false)
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm backdrop-blur transition-all hover:border-indigo-200 hover:bg-white hover:text-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloadingPdf ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                Download PDF
              </button>
            </div>
          </GlassCard>

          {/* ── Tabs ──────────────────────────────────────────────────────── */}
          <GlassCard edge="neutral" innerClassName="overflow-hidden">
            <div className="bg-gradient-to-b from-white/70 to-transparent px-5 pt-1">
              <Tabs tabs={tabDefs} active={tab} onChange={(id) => setTab(id as typeof tab)} />
            </div>

            <div className="p-5 sm:p-6">
              {/* ---- Overview ---- */}
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                    {/* Headline */}
                    <div className="lg:col-span-3">
                      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-6 text-white shadow-[0_10px_30px_-10px_rgba(79,70,229,0.55)]">
                        {/* Soft light, so the panel is not a flat slab */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-fuchsia-400/20 blur-2xl"
                        />
                        <div className="relative">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-200">
                            AI Score Summary
                          </p>
                          <div className="mt-1.5 flex items-end gap-2">
                            <p className="text-5xl font-extrabold leading-none">
                              {report.overall_score != null ? report.overall_score : '—'}
                            </p>
                            <p className="pb-1 text-xl font-medium text-indigo-200">
                              /{report.rubric_total ?? 100}
                            </p>
                          </div>
                          {report.summary && (
                            <p className="mt-3 text-[13px] leading-relaxed text-indigo-100">
                              {report.summary}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        <StatTile
                          icon={<ListChecks size={17} />}
                          tone="indigo"
                          label="Questions"
                          value={questions.length}
                        />
                        <StatTile
                          icon={<CircleGauge size={17} />}
                          tone="violet"
                          label="Points earned"
                          value={`${totalEarned}/${totalPossible}`}
                        />
                        {proctoring?.result?.duration && (
                          <StatTile
                            icon={<Clock size={17} />}
                            tone="sky"
                            label="Duration"
                            value={proctoring.result.duration}
                            mono
                          />
                        )}
                        {proctoring && (
                          <>
                            <StatTile
                              icon={<ShieldAlert size={17} />}
                              tone={hardCount > 0 ? 'rose' : 'muted'}
                              label="Hard flags"
                              value={hardCount}
                            />
                            <StatTile
                              icon={<Eye size={17} />}
                              tone={softCount > 0 ? 'amber' : 'muted'}
                              label="Soft flags"
                              value={softCount}
                            />
                          </>
                        )}
                      </div>
                    </div>

                    {/* Per-question gauges */}
                    {questions.length > 0 && (
                      <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:col-span-2">
                        <h3 className="mb-4 text-sm font-semibold text-slate-800">
                          AI Score Detail
                        </h3>
                        <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                          {questions.map((qs, i) => (
                            <RadialScore
                              key={qs.id || i}
                              value={qs.earned_score ?? 0}
                              max={qs.score || 100}
                              label={`Q${i + 1}`}
                              size={64}
                              stroke={6}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Strengths + areas to improve */}
                  {((report.strengths?.length ?? 0) > 0 ||
                    (report.weaknesses?.length ?? 0) > 0) && (
                    <div className="grid grid-cols-1 items-stretch gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
                      <InsightCard tone="positive" items={report.strengths ?? []} />
                      <InsightCard tone="negative" items={report.weaknesses ?? []} />
                    </div>
                  )}

                  {report.jd_fit && (
                    <div className="border-t border-slate-100 pt-5">
                      <h3 className="mb-2 text-sm font-semibold text-slate-800">JD Fit</h3>
                      <p className="text-[13px] leading-relaxed text-slate-600">{report.jd_fit}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ---- Questions ---- */}
              {tab === 'questions' && <QuestionAccordion questions={questions} />}

              {/* ---- Integrity ---- */}
              {tab === 'integrity' &&
                (proctoring ? (
                  <ProctoringSummary
                    proctoring={proctoring}
                    hardCount={hardCount}
                    softCount={softCount}
                  />
                ) : (
                  <p className="text-sm text-slate-400">
                    No video analysis is available for this interview.
                  </p>
                ))}
            </div>
          </GlassCard>

          {/* Transcript Summary (fallback when full transcript unavailable) */}
          {!report.transcript && report.transcript_summary && (
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_10px_30px_-12px_rgba(15,23,42,0.12)]">
              <h2 className="text-base font-semibold text-slate-800 mb-3">Transcript Summary</h2>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {report.transcript_summary}
              </p>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
