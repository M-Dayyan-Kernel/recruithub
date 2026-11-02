import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { StatusScreen } from '@/components/Shell'
import { formatCountdown, formatInstant } from '@/lib/deadline'

interface Props {
  /** Seconds until the interview can be started, as the server counted them when it answered. */
  opensInSeconds: number
  scheduledAt?: string | null
  /** Called when the wait is over, to ask the server again: it decides, not this clock. */
  onOpen: () => void
}

/**
 * Shown instead of the welcome page and the instructions until the interview's time. The
 * countdown starts from the server's own count, so a candidate whose clock is wrong is not let in
 * early, nor kept waiting. When it reaches zero the server is asked again.
 */
export default function InterviewNotYetOpen({ opensInSeconds, scheduledAt, onOpen }: Props) {
  const [remaining, setRemaining] = useState(opensInSeconds)

  useEffect(() => {
    const endsAt = Date.now() + opensInSeconds * 1000
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000)
      setRemaining(Math.max(0, left))
      if (left <= 0) onOpen()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [opensInSeconds, onOpen])

  const opens = formatInstant(scheduledAt)
  return (
    <StatusScreen
      icon={<Clock size={22} />}
      tone="brand"
      title="Your interview has not opened yet"
      body={
        opens
          ? `It is scheduled for ${opens}. This page unlocks by itself when it is time: keep it open, or come back then.`
          : 'This page unlocks by itself when it is time: keep it open, or come back then.'
      }
    >
      <p
        role="timer"
        aria-live="off"
        className="mt-6 font-display text-[clamp(1.6rem,4vw,2.2rem)] font-semibold tabular-nums text-ink"
      >
        {formatCountdown(remaining)}
      </p>
      <p className="mt-1 text-[0.8rem] text-ink-muted">until you can begin</p>
    </StatusScreen>
  )
}
