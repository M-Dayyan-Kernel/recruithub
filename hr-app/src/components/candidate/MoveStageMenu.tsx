import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, Mail, RotateCcw, Send, Star, Undo2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { CandidateProfile, ReconsiderResponse, ShortlistDecisionResponse } from '@/types/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import MenuButton from '@/components/stage/MenuButton'
import { availableMoves, MOVE_LABEL, type MoveId } from '@/lib/candidateMoves'
import { reconsiderPath } from '@/lib/reconsiderLanding'

const ICON: Record<MoveId, JSX.Element> = {
  approve: <Check size={14} />,
  reject: <X size={14} />,
  send_interview: <Send size={14} />,
  advance: <Mail size={14} />,
  finalist: <Star size={14} />,
  reconsider: <Undo2 size={14} />,
  retry: <RotateCcw size={14} />,
}

interface Dialog {
  title: string
  body: string
  confirm: string
  tone: 'neg' | 'accent'
  needsReason?: boolean
}

function dialogFor(move: MoveId, name: string, state: string | null | undefined): Dialog | null {
  switch (move) {
    case 'approve':
      return {
        title: `Approve ${name}?`,
        body: 'They move on to Phone screening, or straight to Interviews if voice screening is off for this job.',
        confirm: 'Approve',
        tone: 'accent',
      }
    case 'reject':
      return {
        title: `Reject ${name}?`,
        body: 'They move to Rejected and anything not yet started (a call, an interview link) is cancelled. They are not emailed until you send it from the Rejected list, and you can reconsider until then.',
        confirm: 'Reject candidate',
        tone: 'neg',
      }
    case 'send_interview':
      return {
        title: `Send ${name} an interview link?`,
        body:
          state === 'review'
            ? 'Their call result becomes Passed and they are emailed an interview link now.'
            : 'They passed the phone screening. They are emailed an interview link now.',
        confirm: 'Send interview link',
        tone: 'accent',
      }
    case 'advance':
      return {
        title: `Move ${name} to interview without a call?`,
        body: 'They skip the screening call and are emailed an interview link now. The reason is kept in the activity log.',
        confirm: 'Move to interview',
        tone: 'accent',
        needsReason: true,
      }
    case 'finalist':
      return {
        title: `Mark ${name} as a finalist?`,
        body: 'They move to Finalists. A finalist can no longer be rejected.',
        confirm: 'Mark as finalist',
        tone: 'accent',
      }
    case 'reconsider':
      return {
        title: `Reconsider ${name}?`,
        body: 'They go back to the stage they were rejected from. This is possible until the rejection email has been sent.',
        confirm: 'Reconsider',
        tone: 'accent',
      }
    case 'retry':
      return null
  }
}

/**
 * "Move stage": the actions available for the stage the candidate is in. Each asks first (except
 * retrying a failed review), says what will happen, and shows a refusal from the server in the dialog.
 */
export function MoveStageMenu({ profile }: { profile: CandidateProfile }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [move, setMove] = useState<MoveId | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moves = availableMoves(profile.pipeline_stage, profile.stage_state)
  if (moves.length === 0) return null

  const name = profile.name
  const jobId = profile.job_id

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['candidate', profile.id] })
    void queryClient.invalidateQueries({ queryKey: ['candidates'] })
    for (const key of ['shortlist', 'screening', 'interviews-pipeline', 'rejected', 'finalists']) {
      void queryClient.invalidateQueries({ queryKey: [key, jobId] })
    }
  }

  const run = async (id: MoveId) => {
    switch (id) {
      case 'approve': {
        if (!profile.shortlist) throw new Error('This candidate has no resume score to approve.')
        const out = (await api.patch(`/api/shortlist/${profile.shortlist.id}/decision`, {
          hr_decision: 'approved',
        })) as unknown as ShortlistDecisionResponse
        toast.success(`${name} approved and moved to ${out.screening_skipped ? 'Interviews' : 'Phone screening'}`)
        return
      }
      case 'reject':
        await api.post(`/api/jobs/${jobId}/candidates/${profile.id}/reject`)
        toast.success(`${name} moved to Rejected`)
        return
      case 'send_interview': {
        const call = profile.screening
        if (!call) throw new Error('No screening call found.')
        if (call.result !== 'pass') await api.patch(`/api/screening/${call.id}/result`, { result: 'pass' })
        await api.post(`/api/candidates/${profile.id}/interview/send`)
        toast.success(`Interview link sent to ${name}`)
        return
      }
      case 'advance':
        await api.post(`/api/jobs/${jobId}/screening/advance`, { candidate_id: profile.id, reason: reason.trim() })
        toast.success(`${name} moved to Interviews; the link was emailed`)
        return
      case 'finalist':
        await api.post(`/api/candidates/${profile.id}/finalist`)
        toast.success(`${name} marked as a finalist`)
        return
      case 'reconsider': {
        const out = (await api.post(`/api/jobs/${jobId}/rejected/${profile.id}/reconsider`)) as unknown as ReconsiderResponse
        toast.success(`${name} is back in the pipeline`)
        refresh()
        navigate(reconsiderPath(jobId, out.restored_to, out.tab))
        return
      }
      case 'retry':
        await api.post(`/api/jobs/${jobId}/candidates/${profile.id}/retry-processing`)
        toast.success('Re-queued for AI review')
        return
    }
  }

  const perform = async (id: MoveId) => {
    setBusy(true)
    setError(null)
    try {
      await run(id)
      refresh()
      setMove(null)
      setReason('')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not update this candidate. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const choose = (id: MoveId) => {
    // Retrying is harmless and has nothing to confirm; every other move asks first.
    if (id === 'retry') {
      void perform(id)
      return
    }
    setError(null)
    setReason('')
    setMove(id)
  }

  const dialog = move ? dialogFor(move, name, profile.stage_state) : null

  return (
    <>
      <MenuButton
        label="Move stage"
        icon={<ArrowRightLeft size={14} aria-hidden />}
        items={moves.map((id) => ({ label: MOVE_LABEL[id], icon: ICON[id], onClick: () => choose(id) }))}
      />
      {move && dialog && (
        <ConfirmDialog
          title={dialog.title}
          body={<p>{dialog.body}</p>}
          confirmLabel={dialog.confirm}
          tone={dialog.tone}
          busy={busy}
          error={error}
          confirmDisabled={dialog.needsReason ? reason.trim().length < 3 : false}
          onConfirm={() => void perform(move)}
          onClose={() => {
            setMove(null)
            setError(null)
          }}
        >
          {dialog.needsReason && (
            <label className="mt-3 block">
              <span className="mb-1 block text-[12px] font-medium text-ink-muted">Reason</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </label>
          )}
        </ConfirmDialog>
      )}
    </>
  )
}
