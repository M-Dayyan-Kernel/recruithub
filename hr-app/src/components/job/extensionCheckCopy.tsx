import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import InfoPopover from '@/components/ui/InfoPopover'
import type { ExtensionPolicyMode } from '@/types/integrity'

export const EXTENSION_MODES: Array<{
  id: ExtensionPolicyMode
  title: string
  summary: string
}> = [
  {
    id: 'shadow',
    title: 'Shadow',
    summary:
      'Extensions on your blocklist are blocked. Other extensions that look like AI assistants are only recorded for HR and never stop a candidate. Use this while you gather data.',
  },
  {
    id: 'enforce',
    title: 'Enforce',
    summary:
      'Extensions on your blocklist are blocked, and so are other extensions that clearly look like AI assistants that can read the page or capture audio.',
  },
]

/**
 * The "?" shown beside a job's extension-check controls while the organization's switch is off.
 * It says who turned it off and what to do about it, since the controls themselves are greyed out.
 */
export function ExtensionOrgOffHelp() {
  const { isAdmin } = useAuth()
  return (
    <InfoPopover label="Why is this disabled?">
      <span className="block font-semibold text-ink">Turned off by your organization</span>
      <span className="mt-1 block">
        An Admin has turned the AI extension check off for the whole organization, so it does not
        run for any job and cannot be changed here. Each job keeps its own setting, which applies
        again once it is turned back on.
      </span>
      <span className="mt-1 block">
        {isAdmin ? (
          <>
            You can turn it on from the{' '}
            <Link to="/extension-check" className="font-semibold text-accent underline">
              AI extension check page
            </Link>
            .
          </>
        ) : (
          'Ask an Admin to turn it on if this job needs it.'
        )}
      </span>
    </InfoPopover>
  )
}
