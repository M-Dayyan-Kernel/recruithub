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
  opens,
  completeBy,
  onStart,
}: {
  candidateName?: string | null
  jobTitle?: string | null
  /** Scheduled interviews only: when the link opens. */
  opens?: string | null
  /** When the link stops working. */
  completeBy?: string | null
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
      >
        {(opens || completeBy) && (
          <dl className="mx-auto max-w-[440px] space-y-1.5 rounded-[9px] border border-line bg-panel-alt px-4 py-3 text-left text-[0.85rem] text-ink-muted">
            {opens && (
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 font-semibold text-ink">Opens</dt>
                <dd>{opens}</dd>
              </div>
            )}
            {completeBy && (
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 font-semibold text-ink">Complete by</dt>
                <dd>{completeBy}</dd>
              </div>
            )}
          </dl>
        )}
      </Panel>
    </Screen>
  )
}
