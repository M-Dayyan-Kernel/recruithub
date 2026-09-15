import { Hand } from 'lucide-react'
import { IconBadge, Panel, PrimaryButton, Screen } from '@/components/Shell'

/**
 * SESSION_NOT_STARTED / SESSION_VALIDATED (§7.1, PR-STATE-001/002): the
 * candidate has opened a valid link but has not entered the pre-flight gates.
 *
 * It sits outside the gate sequence on purpose - nothing here is a gate, so it
 * records no precondition. It greets the candidate by name and names the role
 * this link belongs to, before they commit to anything.
 */

export default function Welcome({
  candidateName,
  jobTitle,
  onStart,
}: {
  candidateName?: string | null
  jobTitle?: string | null
  onStart: () => void
}) {
  return (
    <Screen>
      <Panel
        badge={
          <IconBadge>
            <Hand size={24} />
          </IconBadge>
        }
        title={candidateName ? `Welcome, ${candidateName}` : 'Welcome'}
        description={
          jobTitle ? (
            <>
              You&rsquo;re interviewing for{' '}
              <strong className="font-semibold text-ink">{jobTitle}</strong>.
            </>
          ) : (
            'You are about to begin your interview.'
          )
        }
        action={<PrimaryButton onClick={onStart}>Get started</PrimaryButton>}
      />
    </Screen>
  )
}
