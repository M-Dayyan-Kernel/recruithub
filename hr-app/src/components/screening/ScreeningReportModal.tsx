import { useEffect, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ScreeningCall } from '@/types/api'
import { ScreeningCallDetails } from '@/components/screening/ScreeningCallDetails'
import { downloadScreeningReportPdf } from '@/lib/screeningReportPdf'

interface Props {
  call: ScreeningCall
  jobId: string
  candidateName: string
  phone?: string | null
  attemptNumber?: number
  jobTitle?: string
  onClose: () => void
}

export function ScreeningReportModal({
  call,
  jobId,
  candidateName,
  phone,
  attemptNumber,
  jobTitle,
  onClose,
}: Props) {
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleDownloadPdf = () => {
    setDownloading(true)
    try {
      downloadScreeningReportPdf(call, {
        candidateName,
        phone,
        jobTitle,
        attemptNumber,
      })
      toast.success('Screening report downloaded')
    } catch {
      toast.error('Failed to generate PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screening-report-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="screening-report-title" className="truncate text-lg font-semibold text-slate-900">
              {candidateName}
            </h2>
            {phone && <p className="truncate text-sm text-slate-500">{phone}</p>}
            <div className="mt-3">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {downloading ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close report"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ScreeningCallDetails
            call={call}
            jobId={jobId}
            attemptNumber={attemptNumber}
            candidateName={candidateName}
            phone={phone}
            variant="embedded"
            showActions={false}
            hideHeader
          />
        </div>
      </div>
    </div>
  )
}
