import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Link2, Loader2, AlertCircle, CheckCircle, XCircle, Sparkles, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { CandidateDetailModal } from '@/components/CandidateDetailModal'
import { BackendError } from '@/components/BackendError'

// ---------------------------------------------------------------------------
// Parse status badge config
// ---------------------------------------------------------------------------

const statusConfig: Record<
  Candidate['parse_status'],
  { label: string; className: string; spinner?: boolean }
> = {
  pending_parse: { label: 'Queued', className: 'bg-slate-100 text-slate-500' },
  parsing: { label: 'Parsing...', className: 'bg-blue-100 text-blue-700', spinner: true },
  parsed: { label: 'Parsed', className: 'bg-amber-100 text-amber-700', spinner: true },
  ready: { label: 'Ready', className: 'bg-emerald-100 text-emerald-700' },
  parse_failed: { label: 'Failed', className: 'bg-rose-100 text-rose-700' },
}

function ParseStatusBadge({ status }: { status: Candidate['parse_status'] }) {
  const cfg = statusConfig[status]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.spinner && <Loader2 size={10} className="animate-spin" />}
      {status === 'ready' && <CheckCircle size={10} />}
      {status === 'parse_failed' && <XCircle size={10} />}
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function CandidateCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-slate-200 rounded w-3/4" />
          <div className="h-2.5 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
      <div className="h-5 w-16 bg-slate-100 rounded-full" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidate card
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  onClick,
  onDelete,
}: {
  candidate: Candidate
  onClick: () => void
  onDelete?: () => void
}) {
  const isClickable = candidate.parse_status === 'ready'
  const isProcessing =
    candidate.parse_status === 'pending_parse' ||
    candidate.parse_status === 'parsing' ||
    candidate.parse_status === 'parsed'

  const displayName =
    candidate.parsed_data?.name ??
    candidate.name ??
    (isProcessing ? 'Parsing...' : `Candidate #${candidate.id}`)

  const email = candidate.parsed_data?.email ?? candidate.email

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`relative group bg-white border border-slate-200 rounded-xl p-4 transition-all ${
        isClickable
          ? 'cursor-pointer hover:border-indigo-300 hover:shadow-sm'
          : 'cursor-default'
      }`}
    >
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 right-2 p-1 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove candidate"
        >
          <Trash2 size={14} />
        </button>
      )}
      <div className="flex items-start gap-3 mb-2.5">
        <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0 uppercase">
          {(displayName)[0] ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
          {email && <p className="text-xs text-slate-400 truncate mt-0.5">{email}</p>}
        </div>
      </div>
      <ParseStatusBadge status={candidate.parse_status} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload zone
// ---------------------------------------------------------------------------

interface UploadZoneProps {
  jobId: string
}

function UploadZone({ jobId }: UploadZoneProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadCount, setUploadCount] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const [driveUrl, setDriveUrl] = useState('')
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [driveNotConfigured, setDriveNotConfigured] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setFileError(null)

    const valid = Array.from(files).filter(
      f => f.name.endsWith('.pdf') || f.name.endsWith('.docx') ||
           f.type === 'application/pdf' ||
           f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    const skipped = files.length - valid.length

    if (valid.length === 0) {
      setFileError('Only PDF and DOCX files are allowed. Please select valid files.')
      return
    }
    if (skipped > 0) {
      setFileError(`${skipped} file(s) were skipped — only PDF and DOCX are supported.`)
    }

    setIsUploading(true)
    setUploadCount(valid.length)
    try {
      const formData = new FormData()
      valid.forEach(file => formData.append('files', file))
      await api.post(`/api/jobs/${jobId}/resumes`, formData)
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    } catch (err) {
      setFileError((err as Error).message ?? 'Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
      setUploadCount(0)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }
  const handleDragLeave = () => setIsDragOver(false)
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }
  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files)
    e.target.value = ''
  }

  const handleDriveImport = async () => {
    if (!driveUrl.trim()) {
      setDriveError('Please enter a Google Drive URL')
      return
    }
    setDriveError(null)
    setDriveNotConfigured(false)
    setDriveLoading(true)
    try {
      await api.post(`/api/jobs/${jobId}/resumes/drive`, { drive_url: driveUrl.trim() })
      setDriveUrl('')
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    } catch (err) {
      const message = (err as Error).message ?? ''
      const status = (err as { response?: { status?: number } }).response?.status
      if (message.includes('google_drive_not_configured') || status === 503) {
        setDriveNotConfigured(true)
      } else {
        setDriveError(message || 'Drive import failed. Please try again.')
      }
    } finally {
      setDriveLoading(false)
    }
  }

  return (
    <div className="mb-6 space-y-3">
      {/* Drop zone */}
      <div
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isUploading ? 'pointer-events-none border-indigo-300 bg-indigo-50' :
          isDragOver
            ? 'border-indigo-400 bg-indigo-50 cursor-copy'
            : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer'
        }`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center justify-center">
            <Loader2 size={24} className="text-indigo-600 animate-spin mb-2" />
            <p className="text-sm text-indigo-700 font-medium">
              Uploading {uploadCount} file{uploadCount !== 1 ? 's' : ''}…
            </p>
          </div>
        ) : (
          <>
            <Upload size={24} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">
              Drag &amp; drop resumes here, or{' '}
              <span className="text-indigo-600">click to browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">PDF and DOCX files supported</p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* File type error */}
      {fileError && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
          <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">{fileError}</p>
        </div>
      )}

      {/* Google Drive import */}
      <div>
        <div className="flex gap-2">
          <input
            type="url"
            value={driveUrl}
            onChange={e => {
              setDriveUrl(e.target.value)
              setDriveError(null)
              setDriveNotConfigured(false)
            }}
            placeholder="Paste Google Drive folder/file URL…"
            disabled={driveLoading}
            className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 ${
              driveError ? 'border-rose-400' : 'border-slate-200'
            }`}
          />
          <button
            onClick={() => void handleDriveImport()}
            disabled={!driveUrl.trim() || driveLoading}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {driveLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            Import
          </button>
        </div>

        {driveError && (
          <p className="mt-1.5 text-xs text-rose-600 flex items-center gap-1">
            <AlertCircle size={11} />
            {driveError}
          </p>
        )}

        {/* Drive 503 fallback — friendly inline message, NOT a crash */}
        {driveNotConfigured && (
          <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-700">
              Google Drive integration isn't set up yet. Please upload files directly instead.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run AI Shortlist button
// ---------------------------------------------------------------------------

function RunShortlistButton({
  jobId,
  hasReadyCandidates,
  onTriggered,
}: {
  jobId: string
  hasReadyCandidates: boolean
  onTriggered: () => void
}) {
  const queryClient = useQueryClient()
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/shortlist`, {}),
    onSuccess: () => {
      setErrorMsg(null)
      setSuccessMsg('Shortlisting started! Switch to the Shortlist tab to see results.')
      toast.success('AI shortlisting started! Results will appear in the Shortlist tab.')
      onTriggered()
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      setTimeout(() => setSuccessMsg(null), 5000)
    },
    onError: (err: Error) => {
      setSuccessMsg(null)
      setErrorMsg(err.message ?? 'Failed to start shortlisting. Please try again.')
      toast.error('Failed to start shortlisting. Please try again.')
    },
  })

  return (
    <div className="mb-5">
      <button
        onClick={() => mutation.mutate()}
        disabled={!hasReadyCandidates || mutation.isPending}
        title={
          !hasReadyCandidates
            ? 'At least one candidate must be fully parsed (Ready) before running AI shortlisting.'
            : undefined
        }
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {mutation.isPending ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Shortlisting in progress…
          </>
        ) : (
          <>
            <Sparkles size={14} />
            Run AI Shortlist
          </>
        )}
      </button>

      {successMsg && (
        <div className="mt-2.5 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
          <CheckCircle size={14} className="text-emerald-500 shrink-0" />
          <p className="text-sm text-emerald-700">{successMsg}</p>
        </div>
      )}

      {errorMsg && (
        <div className="mt-2.5 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
          <AlertCircle size={14} className="text-rose-500 mt-0.5 shrink-0" />
          <p className="text-sm text-rose-700">{errorMsg}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main CandidatesTab
// ---------------------------------------------------------------------------

interface Props {
  jobId: string
  onShortlistTriggered?: () => void
}

export function CandidatesTab({ jobId, onShortlistTriggered }: Props) {
  const queryClient = useQueryClient()
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [pollStartTime] = useState(() => Date.now())

  const { data: candidates, isLoading, isError, refetch } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    refetchInterval: (query) => {
      const hasPending = ((query.state.data ?? []) as Candidate[]).some((c) =>
        ['pending_parse', 'parsing', 'parsed'].includes(c.parse_status),
      )
      if (!hasPending) return false
      const elapsed = Date.now() - pollStartTime
      return elapsed > 120_000 ? 30_000 : 5_000
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/candidates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      toast.success('Candidate removed')
    },
    onError: () => toast.error('Failed to remove candidate'),
  })

  const handleDelete = (id: string) => {
    if (window.confirm('Remove this candidate?')) {
      deleteMutation.mutate(id)
    }
  }

  const hasAny = candidates && candidates.length > 0
  const hasReadyCandidates = !!(candidates?.some(c => c.parse_status === 'ready'))

  // Client-side search + filter
  const filtered = (candidates ?? []).filter((c) => {
    const name = (c.parsed_data?.name ?? c.name ?? '').toLowerCase()
    const matchesSearch = name.includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || c.parse_status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div>
      {/* Candidate detail modal */}
      {selectedCandidateId !== null && (
        <CandidateDetailModal
          candidateId={selectedCandidateId}
          jobId={jobId}
          onClose={() => setSelectedCandidateId(null)}
        />
      )}

      {/* Upload area */}
      <UploadZone jobId={jobId} />

      {/* Run AI Shortlist */}
      <RunShortlistButton
        jobId={jobId}
        hasReadyCandidates={hasReadyCandidates}
        onTriggered={() => onShortlistTriggered?.()}
      />

      {/* Candidate list section */}
      <div className="border-t border-slate-100 pt-5">
        {/* Search + filter controls */}
        {hasAny && (
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search candidates…"
                className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              <option value="all">All Statuses</option>
              <option value="ready">Ready</option>
              <option value="parsing">Parsing</option>
              <option value="pending_parse">Queued</option>
              <option value="parse_failed">Failed</option>
            </select>
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CandidateCardSkeleton key={i} />
            ))}
          </div>
        )}

        {isError && <BackendError onRetry={refetch} />}

        {!isLoading && !isError && !hasAny && (
          <div className="py-10 text-center text-slate-400 text-sm">
            No candidates yet. Upload resumes above to get started.
          </div>
        )}

        {!isLoading && !isError && hasAny && (
          filtered.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              {search
                ? `No results for “${search}”`
                : 'No candidates match the selected filter.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  onDelete={() => handleDelete(candidate.id)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

export default CandidatesTab
