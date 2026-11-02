import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * Escape for dialogs, topmost first. Each open dialog registers here instead of listening on
 * `document` itself: with separate listeners, one Escape closed a modal and the drawer under it
 * together, throwing away whatever was open in both. Here only the most recently opened dialog
 * reacts, so a modal inside a drawer closes alone and the drawer stays.
 */
type Handlers = MutableRefObject<{ onClose: () => void; busy: boolean }>

// Each entry is a ref, so a parent re-rendering with a new callback is seen without re-registering.
const stack: Handlers[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top || top.current.busy) return
  top.current.onClose()
}

export function useEscapeToClose(onClose: () => void, options: { busy?: boolean; enabled?: boolean } = {}) {
  const { busy = false, enabled = true } = options
  const handlers = useRef({ onClose, busy })
  handlers.current = { onClose, busy }

  useEffect(() => {
    if (!enabled) return
    if (stack.length === 0) document.addEventListener('keydown', onKeyDown)
    stack.push(handlers)
    return () => {
      const i = stack.indexOf(handlers)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled])
}
