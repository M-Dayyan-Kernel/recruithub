/**
 * The illustrated header behind an organization card.
 *
 * Soft pastel ground with oversized arcs and dots drawn in a deeper tone of the
 * same hue, so the panel reads as artwork rather than as a coloured rectangle.
 * The palette and the pattern are both picked from a hash of the org id, so a
 * given org keeps its identity across reloads, sorts and filters - a colour
 * that reshuffles on every render is noise, not identity.
 */

export const ORG_PALETTE = [
  { bg: '#E3E7FE', art: '#4F46E5', chip: 'from-indigo-500 to-violet-600 shadow-indigo-500/30' },
  { bg: '#FBE3CB', art: '#C2803A', chip: 'from-amber-400 to-orange-500 shadow-amber-500/30' },
  { bg: '#D9EBD6', art: '#5E8A4E', chip: 'from-emerald-500 to-teal-600 shadow-emerald-500/30' },
  { bg: '#E6E0F8', art: '#6D5BC4', chip: 'from-violet-500 to-fuchsia-600 shadow-violet-500/30' },
  { bg: '#FBDFE6', art: '#C4557A', chip: 'from-rose-500 to-pink-600 shadow-rose-500/30' },
  { bg: '#D3EBE8', art: '#3F8C82', chip: 'from-sky-500 to-indigo-500 shadow-sky-500/30' },
] as const

/** Stable, cheap string hash. Same id in, same colour out, every time. */
export function seedFrom(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

export function paletteFor(id: string) {
  return ORG_PALETTE[seedFrom(id) % ORG_PALETTE.length]
}

/** Three arrangements of the same vocabulary: hooks, rings, dots. */
function Pattern({ variant, art }: { variant: number; art: string }) {
  const stroke = { stroke: art, strokeWidth: 15, fill: 'none', strokeLinecap: 'round' as const }

  if (variant === 0) {
    return (
      <>
        <path d="M18 -20 v46 a26 26 0 0 0 52 0 v-46" {...stroke} />
        <path d="M96 84 v-40 a24 24 0 0 1 48 0 v18" {...stroke} />
        <circle cx="120" cy="22" r="11" fill={art} />
        <circle cx="62" cy="74" r="7" fill={art} />
      </>
    )
  }
  if (variant === 1) {
    return (
      <>
        <path d="M-6 66 a34 34 0 0 1 68 0" {...stroke} />
        <path d="M84 96 v-34 a26 26 0 0 1 52 0 v34" {...stroke} />
        <circle cx="28" cy="20" r="13" fill={art} />
        <circle cx="152" cy="30" r="8" fill={art} />
      </>
    )
  }
  return (
    <>
      <path d="M10 96 v-44 a28 28 0 0 1 56 0 v10" {...stroke} />
      <path d="M150 -10 v40 a24 24 0 0 1 -48 0" {...stroke} />
      <circle cx="92" cy="80" r="10" fill={art} />
      <circle cx="34" cy="26" r="7" fill={art} />
    </>
  )
}

export default function OrgArt({ id, className = '' }: { id: string; className?: string }) {
  const { bg, art } = paletteFor(id)
  const variant = seedFrom(id) % 3

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ backgroundColor: bg }} aria-hidden>
      <svg
        viewBox="0 0 170 96"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        {/* Kept well under the text that sits on top of it. */}
        <g opacity="0.32">
          <Pattern variant={variant} art={art} />
        </g>
      </svg>
    </div>
  )
}
