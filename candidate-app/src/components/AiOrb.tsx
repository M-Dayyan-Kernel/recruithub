/**
 * The AI interviewer's visual presence.
 *
 * Three stacked layers: a soft outer halo, two counter-rotating conic gradient
 * rings, and a glass core. It breathes slowly while listening and lifts into a
 * faster, brighter state while the interviewer speaks, so the candidate always
 * knows whose turn it is. Motion is disabled under prefers-reduced-motion.
 */
export default function AiOrb({
  speaking = false,
  connecting = false,
  size = 132,
}: {
  speaking?: boolean
  connecting?: boolean
  size?: number
}) {
  const state = connecting ? 'connecting' : speaking ? 'speaking' : 'idle'

  return (
    <div
      className={`orb orb--${state} relative`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="orb__halo absolute inset-0 rounded-full" />
      <span className="orb__ring orb__ring--a absolute inset-0 rounded-full" />
      <span className="orb__ring orb__ring--b absolute inset-[10%] rounded-full" />
      <span className="orb__core absolute inset-[22%] rounded-full" />
      <span className="orb__gloss absolute inset-[22%] rounded-full" />

      <style>{`
        .orb__halo {
          background: radial-gradient(circle, rgba(129,140,248,0.55) 0%, rgba(217,70,239,0.25) 45%, transparent 70%);
          filter: blur(18px);
          animation: orb-breathe 4.5s ease-in-out infinite;
        }
        .orb__ring {
          filter: blur(10px);
          opacity: 0.85;
        }
        .orb__ring--a {
          background: conic-gradient(from 0deg, #6366f1, #a855f7, #22d3ee, #6366f1);
          animation: orb-spin 9s linear infinite;
        }
        .orb__ring--b {
          background: conic-gradient(from 180deg, #c084fc, #38bdf8, #818cf8, #c084fc);
          animation: orb-spin 6s linear infinite reverse;
        }
        .orb__core {
          background: radial-gradient(circle at 35% 30%, #eef2ff 0%, #a5b4fc 35%, #4f46e5 100%);
          box-shadow: inset 0 0 24px rgba(15,23,42,0.35);
          animation: orb-breathe 4.5s ease-in-out infinite;
        }
        .orb__gloss {
          background: radial-gradient(circle at 32% 26%, rgba(255,255,255,0.85) 0%, transparent 45%);
        }

        .orb--speaking .orb__halo { animation-duration: 1.1s; filter: blur(24px); }
        .orb--speaking .orb__core { animation-duration: 1.1s; }
        .orb--speaking .orb__ring--a { animation-duration: 3.2s; opacity: 1; }
        .orb--speaking .orb__ring--b { animation-duration: 2.2s; opacity: 1; }

        .orb--connecting .orb__ring--a,
        .orb--connecting .orb__ring--b { opacity: 0.35; }
        .orb--connecting .orb__core { filter: saturate(0.4); }

        @keyframes orb-spin { to { transform: rotate(360deg); } }
        @keyframes orb-breathe {
          0%, 100% { transform: scale(0.94); }
          50%      { transform: scale(1.06); }
        }

        @media (prefers-reduced-motion: reduce) {
          .orb__halo, .orb__core, .orb__ring { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
