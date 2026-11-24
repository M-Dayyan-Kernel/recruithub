import { useEffect } from 'react'
import { useBlocker, type Blocker } from 'react-router-dom'

/**
 * Holds the user on a page while `dirty`, so unsaved work is never lost to a stray click.
 *
 * In-app navigation (a sidebar link, Back, a navigate() call) is caught by the router and comes
 * back as a blocked `Blocker` for the page to ask about. Closing or reloading the tab can only
 * get the browser's own prompt: browsers do not let a page show its own dialog there.
 *
 * A navigation that stays on the same path (a query-string change, a step inside the page) is
 * never blocked.
 */
export function useUnsavedChangesGuard(dirty: boolean): Blocker {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Older browsers need a value set to show the prompt; the text itself is ignored.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Changes saved (or discarded) while a navigation waits: let it through.
  useEffect(() => {
    if (blocker.state === 'blocked' && !dirty) blocker.proceed()
  }, [blocker, dirty])

  return blocker
}
