import { useState } from 'react'
import toast from 'react-hot-toast'
import { Download, Loader2 } from 'lucide-react'
import type { ShortlistResultWithCandidate } from '@/types/api'
import { downloadShortlistReportPdf } from '@/lib/shortlistReportPdf'

interface Props {
  result: ShortlistResultWithCandidate
  requiredSkills: string[]
  jobTitle?: string
  layout?: 'row' | 'compact'
}

export function ShortlistReportActions({
  result,
  requiredSkills,
  jobTitle,
  layout = 'row',
}: Props) {
  const [downloading, setDownloading] = useState(false)

  const handleDownloadPdf = () => {
    setDownloading(true)
    try {
      downloadShortlistReportPdf(result, requiredSkills, { jobTitle })
      toast.success('PDF report downloaded')
    } catch {
      toast.error('Failed to generate PDF')
    } finally {
      setDownloading(false)
    }
  }

  const buttonClass =
    layout === 'compact'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <button
      type="button"
      onClick={handleDownloadPdf}
      disabled={downloading}
      className={buttonClass}
      aria-label={`Download PDF report for ${result.candidate_name ?? 'candidate'}`}
    >
      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {downloading ? 'Generating…' : 'Download PDF'}
    </button>
  )
}
