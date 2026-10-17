import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Eye,
  Flag,
  ImageOff,
  Loader2,
  Pause,
  Play,
  ScanFace,
  Smartphone,
  Users,
} from 'lucide-react'
import DetectionFrames, { useFlagFrames } from './DetectionFrames'
import type { VideoProctoringFlag } from '@/types/api'

/**
 * Recording player with the proctoring flags pinned onto the scrub bar.
 *
 * The markers are the point of this component: a reviewer should be able to see
 * where the detections cluster without playing anything, then jump straight to
 * one. Hovering a marker previews the event; clicking it seeks.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "HH:MM:SS" or "MM:SS" -> seconds. Returns null on anything unparseable. */
export function parseTimestamp(ts: string | null | undefined): number | null {
  if (!ts) return null
  const parts = ts.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

export function formatClock(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '0:00'
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function isHard(severity: string | undefined): boolean {
  return (severity ?? '').toUpperCase() === 'HARD'
}

/** Picks an icon from the event wording - the backend sends prose, not a code. */
export function flagIcon(event: string) {
  const e = event.toLowerCase()
  if (e.includes('phone') || e.includes('device')) return Smartphone
  if (e.includes('multiple') || e.includes('faces')) return Users
  if (e.includes('no face') || e.includes('face')) return ScanFace
  if (e.includes('look') || e.includes('gaze')) return Eye
  return Flag
}

export interface TimedFlag extends VideoProctoringFlag {
  atSec: number
}

/** Drops flags we cannot place on the bar, and orders them by time. */
export function toTimedFlags(flags: VideoProctoringFlag[] | null | undefined): TimedFlag[] {
  return (flags ?? [])
    .map((f) => ({ ...f, atSec: parseTimestamp(f.timestamp) }))
    .filter((f): f is TimedFlag => f.atSec != null)
    .sort((a, b) => a.atSec - b.atSec)
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export default function ProctoringPlayer({
  src,
  flags,
  /** Fallback when the file's own metadata has not loaded yet. */
  fallbackDurationSec,
  currentTimeSec,
  onTimeUpdate,
  onSeekRef,
  candidateName,
  caption,
}: {
  src: string
  flags: TimedFlag[]
  fallbackDurationSec?: number | null
  currentTimeSec: number
  onTimeUpdate: (sec: number) => void
  /** Lets the parent seek this player (e.g. from a transcript turn). */
  onSeekRef?: (seek: (sec: number) => void) => void
  /** Shown over the top-left of the frame. */
  candidateName?: string | null
  /** The transcript line being spoken right now, subtitled over the frame. */
  caption?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Index into `flags`, since the captured frames are keyed the same way.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const hovered = hoveredIdx != null ? (flags[hoveredIdx] ?? null) : null
  // Collapsed by default: eight rows would make this card far taller than the
  // transcript beside it. The header keeps the counts visible either way.
  const [listOpen, setListOpen] = useState(false)
  // Until the first play the frame is an empty black box; cover it with a poster.
  const [started, setStarted] = useState(false)

  // The file's real duration wins; the analyser's reported one is the fallback
  // so markers can still be placed before metadata arrives.
  const total = duration || fallbackDurationSec || 0

  const { thumbs, status: frameStatus } = useFlagFrames(src, flags)

  const seek = useCallback((sec: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = sec
    void v.play().catch(() => undefined)
  }, [])

  useEffect(() => {
    onSeekRef?.(seek)
  }, [onSeekRef, seek])

  const pct = total > 0 ? Math.min(100, (currentTimeSec / total) * 100) : 0

  const hardTotal = useMemo(() => flags.filter((f) => isHard(f.severity)).length, [flags])

  const scrubTo = (clientX: number) => {
    const bar = barRef.current
    if (!bar || total <= 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    seek(ratio * total)
  }

  // The flag the playhead is currently sitting on, for the list highlight.
  const activeFlag = useMemo(() => {
    let found: TimedFlag | null = null
    for (const f of flags) {
      if (f.atSec <= currentTimeSec + 0.25) found = f
      else break
    }
    return found && currentTimeSec - found.atSec < 6 ? found : null
  }, [flags, currentTimeSec])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_10px_30px_-12px_rgba(15,23,42,0.12)]">
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
        <video
          ref={videoRef}
          className="max-h-[26rem] w-full bg-transparent object-contain"
          src={src}
          preload="metadata"
          playsInline
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
          onPlay={() => {
            setPlaying(true)
            setStarted(true)
          }}
          onPause={() => setPlaying(false)}
        />

        {/* Idle poster - a black rectangle reads as broken */}
        {!started && (
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current
              if (v) void v.play().catch(() => undefined)
            }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900/90 via-indigo-950/85 to-slate-900/90 backdrop-blur-[2px] transition-colors hover:from-slate-900/85 hover:to-slate-900/85"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_8px_30px_rgba(99,102,241,0.55)] transition-transform hover:scale-105">
              <Play size={24} className="ml-1 text-white" />
            </span>
            <span className="text-[13px] font-medium text-white/90">Play interview recording</span>
            {total > 0 && (
              <span className="font-mono text-[11px] text-white/50">{formatClock(total)}</span>
            )}
          </button>
        )}

        {/* Who is on screen */}
        {candidateName && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-white/85 py-1 pl-1 pr-3 shadow-sm ring-1 ring-black/5 backdrop-blur">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
              {candidateName.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-[12px] font-semibold text-slate-800">{candidateName}</span>
          </div>
        )}

        {/* What was detected at this moment */}
        {activeFlag && (
          <div
            className={`pointer-events-none absolute right-3 top-3 max-w-[14rem] rounded-xl bg-white/90 px-3 py-2 shadow-sm ring-1 backdrop-blur ${
              isHard(activeFlag.severity) ? 'ring-rose-200' : 'ring-amber-200'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 animate-pulse rounded-full ${
                  isHard(activeFlag.severity) ? 'bg-rose-500' : 'bg-amber-500'
                }`}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${
                  isHard(activeFlag.severity) ? 'text-rose-600' : 'text-amber-600'
                }`}
              >
                {isHard(activeFlag.severity) ? 'Hard flag' : 'Soft flag'}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-snug text-slate-800">
              {activeFlag.event}
            </p>
          </div>
        )}

        {/* Subtitle for the line being spoken */}
        {caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-5">
            <p className="max-w-lg rounded-lg bg-white/90 px-3 py-1.5 text-center text-[12px] font-medium leading-snug text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur">
              {caption}
            </p>
          </div>
        )}
      </div>

      {/* Controls + marked scrub bar */}
      <div className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/70 px-4 pb-3 pt-2.5">
        <div className="relative pt-7">
          {/* Hover preview - the captured frame, then what was detected */}
          {hovered && hoveredIdx != null && total > 0 && (
            <div
              className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2"
              style={{ left: `${Math.min(84, Math.max(16, (hovered.atSec / total) * 100))}%` }}
            >
              <div
                className={`w-60 overflow-hidden rounded-xl border bg-white shadow-xl ${
                  isHard(hovered.severity) ? 'border-rose-200' : 'border-amber-200'
                }`}
              >
                {frameStatus !== 'failed' && (
                  <div className="relative aspect-video w-full bg-gradient-to-br from-slate-800 to-slate-900">
                    {thumbs[hoveredIdx] ? (
                      <img src={thumbs[hoveredIdx]} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center">
                        {frameStatus === 'working' ? (
                          <Loader2 size={16} className="animate-spin text-white/50" aria-hidden />
                        ) : (
                          <ImageOff size={16} className="text-white/50" aria-hidden />
                        )}
                      </span>
                    )}
                    <span className="absolute bottom-2 right-2 rounded bg-slate-950/75 px-1.5 py-0.5 font-mono text-[11px] text-white backdrop-blur-sm">
                      {formatClock(hovered.atSec)}
                    </span>
                  </div>
                )}

                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        isHard(hovered.severity) ? 'text-rose-600' : 'text-amber-600'
                      }`}
                    >
                      {isHard(hovered.severity) ? 'Hard' : 'Soft'}
                    </span>
                    {/* The frame carries the time; repeat it only when there is no frame */}
                    {frameStatus === 'failed' && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                        {formatClock(hovered.atSec)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] font-medium leading-snug text-slate-800">
                    {hovered.event}
                  </p>
                  {hovered.confidence != null && (
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {Math.round(hovered.confidence * 100)}% confidence
                    </p>
                  )}
                </div>
              </div>

              {/* Pointer down to the marker */}
              <span
                className={`absolute left-1/2 top-full -mt-[5px] h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r bg-white ${
                  isHard(hovered.severity) ? 'border-rose-200' : 'border-amber-200'
                }`}
              />
            </div>
          )}

          {/* Bar */}
          <div
            ref={barRef}
            onClick={(e) => scrubTo(e.clientX)}
            className="relative h-1.5 w-full cursor-pointer rounded-full bg-slate-200"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
              style={{ width: `${pct}%` }}
            />

            {/* Playhead */}
            <span
              className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-indigo-500"
              style={{ left: `${pct}%` }}
            />

            {/* Flag markers */}
            {total > 0 &&
              flags.map((f, i) => (
                <button
                  key={`${f.timestamp}-${i}`}
                  type="button"
                  aria-label={`${f.event} at ${f.timestamp}`}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onFocus={() => setHoveredIdx(i)}
                  onBlur={() => setHoveredIdx(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    seek(f.atSec)
                  }}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-white shadow-sm transition-transform hover:scale-150 ${
                    isHard(f.severity) ? 'bg-rose-500' : 'bg-amber-400'
                  }`}
                  style={{ left: `${Math.min(100, (f.atSec / total) * 100)}%` }}
                />
              ))}
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current
              if (!v) return
              if (v.paused) void v.play().catch(() => undefined)
              else v.pause()
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30 transition-transform hover:scale-105"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>

          <span className="font-mono text-[12px] text-slate-500">
            {formatClock(currentTimeSec)} / {formatClock(total)}
          </span>

          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> Hard
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Soft
            </span>
          </div>
        </div>
      </div>

      <DetectionFrames flags={flags} thumbs={thumbs} status={frameStatus} onSeek={seek} />

      {/* Detections - collapsed by default, expands into a scrolling list */}
      {flags.length > 0 && (
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <span className="text-[13px] font-semibold text-slate-800">
              {flags.length} detection{flags.length === 1 ? '' : 's'}
            </span>

            <span className="flex items-center gap-1.5">
              {hardTotal > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-600">
                  {hardTotal} hard
                </span>
              )}
              {flags.length - hardTotal > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                  {flags.length - hardTotal} soft
                </span>
              )}
            </span>

            <span className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-indigo-600">
              {listOpen ? 'Hide' : 'Show all'}
              <ChevronDown
                size={15}
                className={`transition-transform duration-200 ${listOpen ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {listOpen && (
            <div className="max-h-72 overflow-y-auto border-t border-slate-100">
              {flags.map((f, i) => {
                const Icon = flagIcon(f.event)
                const active = activeFlag === f
                return (
                  <button
                    key={`row-${f.timestamp}-${i}`}
                    type="button"
                    onClick={() => seek(f.atSec)}
                    className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                      active
                        ? 'bg-gradient-to-r from-indigo-50 to-transparent'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        isHard(f.severity)
                          ? 'bg-gradient-to-br from-rose-100 to-rose-50 text-rose-600'
                          : 'bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600'
                      }`}
                    >
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-slate-800">
                        {f.event}
                      </span>
                      {f.confidence != null && (
                        <span className="block text-[11px] text-slate-400">
                          {Math.round(f.confidence * 100)}% confidence
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        isHard(f.severity)
                          ? 'bg-rose-50 text-rose-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {isHard(f.severity) ? 'Hard' : 'Soft'}
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-slate-400">
                      {formatClock(f.atSec)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
