import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Modal from '@/components/ui/Modal'

/**
 * A stage's settings (the phone call window and questions, the interview topics), opened from its
 * Settings button. A full-screen modal over a blurred page, rendered into `document.body` so it
 * sits above everything rather than inside the section that opened it. It replaces the side
 * drawer: the editors are long and read better centred, and a modal keeps focus on the one task.
 *
 * Mount it to open it and unmount it to close it. Escape and a click on the scrim close it, unless
 * `busy`. Focus moves in, and back to what opened it on close.
 */
export default function SettingsModal({
  title,
  description,
  onClose,
  busy = false,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  /** Blocks every way of closing while a save runs. */
  busy?: boolean
  children: ReactNode
}) {
  return createPortal(
    <Modal title={title} description={description} onClose={onClose} busy={busy} size="xl" blur>
      <div className="p-5">{children}</div>
    </Modal>,
    document.body,
  )
}
