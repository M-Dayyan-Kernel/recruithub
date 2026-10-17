/**
 * Decorative panel artwork for the auth pages.
 *
 * Drawn rather than an imported illustration, so it scales cleanly, weighs
 * nothing, and stays recolourable. It abstracts what the product does: an
 * interview frame with the AI speaking, scored and cleared.
 */
export default function AuthArt() {
  return (
    <svg
      viewBox="0 0 420 420"
      fill="none"
      className="relative h-auto w-full max-w-[420px]"
      aria-hidden
    >
      <defs>
        <linearGradient id="aa-orb" x1="150" y1="120" x2="250" y2="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A5B4FC" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="aa-card" x1="70" y1="110" x2="330" y2="300" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F5F6FA" />
        </linearGradient>
        <filter id="aa-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="14" floodColor="#1e1b4b" floodOpacity="0.12" />
        </filter>
        <filter id="aa-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1e1b4b" floodOpacity="0.1" />
        </filter>
      </defs>

      {/* Colour blooms */}
      <circle cx="120" cy="120" r="92" fill="#C7D2FE" opacity="0.5" />
      <circle cx="305" cy="180" r="78" fill="#FBCFE8" opacity="0.45" />
      <circle cx="230" cy="330" r="86" fill="#A7F3D0" opacity="0.45" />

      {/* Interview frame */}
      <g filter="url(#aa-shadow)">
        <rect x="68" y="108" width="264" height="188" rx="22" fill="url(#aa-card)" />
      </g>
      <rect x="68" y="108" width="264" height="36" rx="22" fill="#EEF2FF" />
      <rect x="68" y="126" width="264" height="18" fill="#EEF2FF" />
      <circle cx="90" cy="126" r="4.5" fill="#FCA5A5" />
      <circle cx="104" cy="126" r="4.5" fill="#FDE68A" />
      <circle cx="118" cy="126" r="4.5" fill="#A7F3D0" />

      {/* The AI, mid sentence */}
      <circle cx="200" cy="196" r="34" fill="url(#aa-orb)" />
      <circle cx="189" cy="185" r="11" fill="#fff" opacity="0.5" />

      {/* Voice */}
      {[
        [150, 14],
        [162, 26],
        [174, 20],
        [226, 20],
        [238, 30],
        [250, 16],
      ].map(([x, h], i) => (
        <rect
          key={i}
          x={x}
          y={196 - h / 2}
          width="5"
          height={h}
          rx="2.5"
          fill="#6366F1"
          opacity={0.35 + (i % 3) * 0.2}
        />
      ))}

      <rect x="150" y="256" width="100" height="8" rx="4" fill="#E0E7FF" />
      <rect x="170" y="272" width="60" height="8" rx="4" fill="#EDE9FE" />

      {/* Score chip */}
      <g filter="url(#aa-soft)">
        <rect x="286" y="242" width="86" height="46" rx="14" fill="#fff" />
      </g>
      <circle cx="308" cy="265" r="12" fill="none" stroke="#E2E8F0" strokeWidth="4" />
      <circle
        cx="308"
        cy="265"
        r="12"
        fill="none"
        stroke="#10B981"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="56 20"
        transform="rotate(-90 308 265)"
      />
      <rect x="328" y="258" width="30" height="6" rx="3" fill="#CBD5E1" />
      <rect x="328" y="270" width="20" height="6" rx="3" fill="#E2E8F0" />

      {/* Integrity chip */}
      <g filter="url(#aa-soft)">
        <rect x="42" y="228" width="74" height="42" rx="14" fill="#fff" />
      </g>
      <path
        d="M64 239 L74 243 v7c0 6-4 9.5-10 11.5-6-2-10-5.5-10-11.5v-7z"
        fill="#34D399"
      />
      <path
        d="M59.5 249.5 L62.5 252.5 L68 247"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect x="84" y="243" width="24" height="6" rx="3" fill="#CBD5E1" />
      <rect x="84" y="254" width="16" height="6" rx="3" fill="#E2E8F0" />

      {/* Confetti */}
      <circle cx="352" cy="118" r="10" fill="#FBBF24" />
      <rect x="54" y="150" width="17" height="17" rx="5" fill="#818CF8" transform="rotate(-18 62 158)" />
      <circle cx="300" cy="352" r="8" fill="#F472B6" />
      <rect x="124" y="330" width="14" height="14" rx="4" fill="#34D399" transform="rotate(24 131 337)" />
    </svg>
  )
}
