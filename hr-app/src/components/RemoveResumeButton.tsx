import { useState } from 'react'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BTN_GHOST } from '@/components/ui/Surface'
import { useDeleteCandidate } from '@/hooks/useDeleteCandidate'

/**
 * Remove one uploaded resume, after a confirm. For the rows HR cannot fix any other way: a
 * duplicate, a file that will never read, or one stuck behind a stalled review.
 */
export function RemoveResumeButton({
  jobId,
  candidateId,
  name,
  disabled = false,
}: {
  jobId: string
  candidateId: string
  name: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = useDeleteCandidate(jobId, { quiet: true })

  const close = () => {
    if (remove.isPending) return
    setOpen(false)
    setError(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || remove.isPending}
        className={BTN_GHOST}
      >
        <Trash2 size={13} aria-hidden />
        Remove
      </button>
      {open && (
        <ConfirmDialog
          title="Remove this resume?"
          body={
            <>
              <span className="font-medium text-ink">{name}</span> and its uploaded file will be deleted
              from this job. This cannot be undone.
            </>
          }
          confirmLabel="Remove"
          tone="neg"
          busy={remove.isPending}
          error={error}
          onClose={close}
          onConfirm={() =>
            remove.mutate(candidateId, {
              onSuccess: () => {
                setOpen(false)
                toast.success('Resume removed')
              },
              onError: (err: Error) => setError(err.message || 'The resume could not be removed.'),
            })
          }
        />
      )}
    </>
  )
}

export default RemoveResumeButton
