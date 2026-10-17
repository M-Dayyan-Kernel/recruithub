import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, Play } from 'lucide-react'
import { flagIcon, formatClock, isHard, type TimedFlag } from './ProctoringPlayer'

/**
 * Thumbnails of the moment each detection fired.
 *
 * Grabbed in the browser rather than stored: a hidden video is seeked to each
 * flag and the frame is drawn to a canvas. The recording is served with
 * `Access-Control-Allow-Origin: *`, so `crossOrigin="anonymous"` keeps the
 * canvas untainted and `toDataURL` legal. Seeking uses range requests, so this
 * pulls a few small slices rather than the whole file.
 *
 * Every failure path degrades to a card without an image - a reviewer still
 * gets the event and its timestamp, and playback is never affected because the
 * capture element is separate from the player.
 */

export type FrameStatus = 'idle' | 'working' | 'done' | 'failed'

/** Seeks to `t` and resolves once a frame is actually decoded there. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('seek timeout')), 8000)
    const done = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

/**
 * Captures one frame per flag, keyed by the flag's index in `flags`.
 *
 * Lives in a hook rather than the strip because the scrub-bar hover preview
 * shows the same frames - capturing twice would decode the recording twice.
 */
export function useFlagFrames(src: string, flags: TimedFlag[]) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<FrameStatus>('idle')
  const cancelled = useRef(false)

  useEffect(() => {
    if (flags.length === 0) return
    cancelled.current = false
    setThumbs({})
    setStatus('working')

    const video = document.createElement('video')
    // Must be set before src, or the request is made without CORS.
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = src

    const canvas = document.createElement('canvas')

    const capture = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          const ok = () => resolve()
          const bad = () => reject(new Error('video load failed'))
          video.addEventListener('loadeddata', ok, { once: true })
          video.addEventListener('error', bad, { once: true })
          window.setTimeout(bad, 15000)
        })
        if (cancelled.current) return

        canvas.width = 320
        canvas.height = Math.round(
          320 * ((video.videoHeight || 9) / (video.videoWidth || 16)),
        )
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')

        for (let i = 0; i < flags.length; i += 1) {
          if (cancelled.current) return
          // A flag at the very end can sit past the decodable range.
          const at = Math.min(flags[i].atSec, Math.max(0, (video.duration || 0) - 0.1))
          await seekTo(video, at)
          if (cancelled.current) return
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const url = canvas.toDataURL('image/jpeg', 0.7)
          setThumbs((prev) => ({ ...prev, [i]: url }))
        }
        if (!cancelled.current) setStatus('done')
      } catch {
        // Tainted canvas, a blocked fetch, or a decode failure - show the
        // cards without images rather than hiding the section.
        if (!cancelled.current) setStatus('failed')
      } finally {
        video.removeAttribute('src')
        video.load()
      }
    }

    void capture()
    return () => {
      cancelled.current = true
      video.removeAttribute('src')
    }
  }, [src, flags])

  return { thumbs, status }
}

export default function DetectionFrames({
  flags,
  thumbs,
  status,
  onSeek,
}: {
  flags: TimedFlag[]
  thumbs: Record<number, string>
  status: FrameStatus
  onSeek: (sec: number) => void
}) {
  if (flags.length === 0) return null

  return (
    <div className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/70 px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-slate-800">Detection frames</h3>
        <span className="text-[11px] text-slate-400">
          {status === 'working'
            ? 'capturing…'
            : status === 'failed'
              ? 'preview unavailable'
              : 'what the camera saw'}
        </span>
        {status === 'working' && (
          <Loader2 size={13} className="animate-spin text-indigo-500" aria-hidden />
        )}
      </div>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {flags.map((f, i) => {
          const Icon = flagIcon(f.event)
          const hard = isHard(f.severity)
          const thumb = thumbs[i]

          return (
            <button
              key={`frame-${f.timestamp}-${i}`}
              type="button"
              onClick={() => onSeek(f.atSec)}
              title={`${f.event} at ${formatClock(f.atSec)}`}
              className={`group relative w-44 shrink-0 overflow-hidden rounded-xl bg-slate-100 text-left ring-1 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                hard ? 'ring-rose-200 hover:shadow-rose-500/20' : 'ring-amber-200 hover:shadow-amber-500/20'
              }`}
            >
              <div className="relative aspect-video w-full bg-gradient-to-br from-slate-200 to-slate-100">
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center">
                    {status === 'working' ? (
                      <Loader2 size={16} className="animate-spin text-slate-400" aria-hidden />
                    ) : (
                      <ImageOff size={16} className="text-slate-400" aria-hidden />
                    )}
                  </span>
                )}

                {/* Scrim so the caption stays readable over any frame */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent" />

                {/* Severity chip */}
                <span
                  className={`absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow ${
                    hard
                      ? 'bg-gradient-to-r from-rose-500 to-pink-600'
                      : 'bg-gradient-to-r from-amber-400 to-orange-500'
                  }`}
                >
                  {hard ? 'Hard' : 'Soft'}
                </span>

                {/* Timestamp */}
                <span className="absolute right-2 top-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
                  {formatClock(f.atSec)}
                </span>

                {/* Caption */}
                <span className="absolute inset-x-2 bottom-1.5 flex items-center gap-1.5">
                  <Icon size={11} className="shrink-0 text-white/90" aria-hidden />
                  <span className="truncate text-[11px] font-medium text-white">{f.event}</span>
                </span>

                {/* Play affordance */}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur">
                    <Play size={14} className="ml-0.5 text-indigo-600" />
                  </span>
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
