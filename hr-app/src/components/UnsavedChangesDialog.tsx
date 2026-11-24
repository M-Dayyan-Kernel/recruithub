import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Save } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { FormAlert } from '@/components/ui/FormAlert'
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'

/**
 * "Leave without saving?" for a page with unsaved work, shown when the user tries to go
 * somewhere else. Three answers: stay, throw the work away, or keep it as a draft and go on to
 * where they were heading. `onSaveDraft` returns whether the draft was kept; when it was not,
 * the dialog stays open and says so, because leaving then would lose the work after all.
 */
export function UnsavedChangesDialog({
  title = 'Leave without saving?',
  body,
  onStay,
  onDiscard,
  onSaveDraft,
}: {
  title?: string
  body: string
  onStay: () => void
  onDiscard: () => void
  /** Omit when there is nothing to save a draft of; only Keep editing and Discard show. */
  onSaveDraft?: () => boolean | Promise<boolean>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveAndLeave = async () => {
    if (!onSaveDraft) return
    setSaving(true)
    setError(null)
    try {
      const saved = await onSaveDraft()
      if (!saved) setError('The draft could not be saved in this browser. Your changes are still here.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <Modal title={title} onClose={onStay} busy={saving}>
      <div className="space-y-4 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">{body}</p>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onStay} disabled={saving} className={BTN_GHOST}>
            Keep editing
          </button>
          <button type="button" onClick={onDiscard} disabled={saving} className={BTN_SECONDARY}>
            Discard
          </button>
          {onSaveDraft && (
            <button type="button" onClick={() => void saveAndLeave()} disabled={saving} className={BTN_PRIMARY}>
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}
              Save draft &amp; leave
            </button>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

export default UnsavedChangesDialog
