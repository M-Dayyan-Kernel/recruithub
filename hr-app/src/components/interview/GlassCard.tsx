import type { ReactNode } from 'react'

/**
 * A card with a real gradient border.
 *
 * CSS has no gradient `border-color`, so the outer element *is* the gradient
 * and a 1px pad lets it show around an opaque inner surface. The inner surface
 * is translucent with a blur, so the glow placed behind a card diffuses through
 * it rather than being clipped away.
 */

const EDGES = {
  neutral: 'from-slate-200 via-slate-100 to-slate-200',
  brand: 'from-indigo-300/70 via-violet-200/50 to-fuchsia-200/60',
  danger: 'from-rose-300/70 via-rose-200/40 to-amber-200/50',
} as const

export type GlassEdge = keyof typeof EDGES

export default function GlassCard({
  children,
  edge = 'neutral',
  glow = false,
  className = '',
  innerClassName = '',
}: {
  children: ReactNode
  edge?: GlassEdge
  /** Adds a diffuse colour bloom behind the card. */
  glow?: boolean
  className?: string
  innerClassName?: string
}) {
  return (
    <div className={`relative ${className}`}>
      {glow && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute -left-6 -top-8 h-40 w-40 rounded-full bg-indigo-400/20 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -right-4 h-40 w-40 rounded-full bg-fuchsia-400/15 blur-3xl"
          />
        </>
      )}

      <div
        className={`relative rounded-2xl bg-gradient-to-br p-px shadow-[0_1px_3px_rgba(15,23,42,0.04),0_14px_40px_-16px_rgba(49,46,129,0.28)] ${EDGES[edge]}`}
      >
        <div
          className={`rounded-[15px] bg-white/85 backdrop-blur-xl ${innerClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
