import { Loader2, Users } from 'lucide-react'
import { PrimaryButton, StatusCard } from '@/components/GradientShell'

interface InterviewBusyScreenProps {
  retryAfterMinutes: number
  onRetry?: () => void
  retrying?: boolean
}

export default function InterviewBusyScreen({
  retryAfterMinutes,
  onRetry,
  retrying = false,
}: InterviewBusyScreenProps) {
  return (
    <StatusCard
      icon={<Users size={22} />}
      tone="brand"
      title="All interviewers are busy"
      body={`Every AI interviewer is with another candidate right now. Try again in about ${retryAfterMinutes} minutes, your link stays valid.`}
      footer={
        onRetry ? (
          <PrimaryButton onClick={onRetry} busy={retrying}>
            {retrying && <Loader2 size={17} className="animate-spin" />}
            {retrying ? 'Checking availability' : 'Try again'}
          </PrimaryButton>
        ) : undefined
      }
    />
  )
}
