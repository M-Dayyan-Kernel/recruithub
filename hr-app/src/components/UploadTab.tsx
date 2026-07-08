import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Upload,
  Loader2,
  AlertCircle,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_TABLE_CLASS,
  WORKFLOW_TABLE_EMPTY_ROW_CLASS,
  WORKFLOW_TABLE_EMPTY_CELL_CLASS,
  formatUploadedAt,
  resumeDisplayName,
} from '@/lib/workflow'

function UploadZone({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadCount, setUploadCount] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setFileError(null)

    const valid = Array.from(files).filter(
      (f) =>
        f.name.endsWith('.pdf') ||
        f.name.endsWith('.docx') ||
        f.name.endsWith('.zip') ||
        f.type === 'application/pdf' ||
        f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        f.type === 'application/zip' ||
        f.type === 'application/x-zip-compressed',
    )
    const skipped = files.length - valid.length

    if (valid.length === 0) {
      setFileError('Only PDF, DOCX, and ZIP files are allowed. Please select valid files.')
      return
    }
    if (skipped > 0) {
      setFileError(`${skipped} file(s) were skipped — only PDF, DOCX, and ZIP are supported.`)
    }

    setIsUploading(true)
    setUploadCount(valid.length)
    try {
      const formData = new FormData()
      valid.forEach((file) => formData.append('files', file))
      const result = (await api.post(
        `/api/jobs/${jobId}/resumes`,
        formData,
      )) as { created: number; skipped_oversized?: string[] }
      invalidate()
      if (result.created > 0) {
        toast.success(`${result.created} resume(s) uploaded`)
      } else {
        toast.success('Upload complete — no new resumes added')
      }
      if (result.skipped_oversized && result.skipped_oversized.length > 0) {
        setFileError(
          `${result.skipped_oversized.length} file(s) exceeded the 20 MB limit and were skipped: ${result.skipped_oversized.join(', ')}`,
        )
      }
    } catch (err) {
      setFileError((err as Error).message ?? 'Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
      setUploadCount(0)
    }
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragOver={(e: DragEvent) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          setIsDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isUploading
            ? 'pointer-events-none border-indigo-300 bg-indigo-50'
            : isDragOver
              ? 'cursor-copy border-indigo-400 bg-indigo-50'
              : 'cursor-pointer border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40'
        }`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center justify-center">
            <Loader2 size={24} className="mb-2 animate-spin text-indigo-600" />
            <p className="text-sm font-medium text-indigo-700">
              Uploading {uploadCount} file{uploadCount !== 1 ? 's' : ''}…
            </p>
          </div>
        ) : (
          <>
            <Upload size={24} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">
              Drag &amp; drop resumes here, or{' '}
              <span className="text-indigo-600">click to browse</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">PDF, DOCX, and ZIP files supported</p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.zip"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>

      {fileError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-700">{fileError}</p>
        </div>
      )}
    </div>
  )
}

interface Props {
  jobId: string
  queueCandidates: Candidate[]
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
}

export function UploadTab({
  jobId,
  queueCandidates,
  isLoading = false,
  isError = false,
  onRetry,
}: Props) {
  const queryClient = useQueryClient()

  const waitingInQueue = queueCandidates.filter((c) => c.parse_status === 'pending_parse')
  const queuedForParsing = queueCandidates.filter((c) => c.parse_status === 'parse_queued')

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/candidates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      toast.success('Resume removed')
    },
    onError: () => toast.error('Failed to remove resume'),
  })

  const retryMutation = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/api/jobs/${jobId}/candidates/${candidateId}/retry-parse`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      toast.success('Re-queued for parsing')
    },
    onError: () => toast.error('Failed to retry parse'),
  })

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Remove ${name}?`)) deleteMutation.mutate(id)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Upload Resumes</h2>
        <p className="text-sm text-slate-500">Upload resumes to begin the parsing process.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <UploadZone jobId={jobId} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Queued Resumes</h2>
          {waitingInQueue.length > 0 && (
            <span className="text-sm text-slate-500">
              {waitingInQueue.length} waiting for a parse slot
            </span>
          )}
          {queuedForParsing.length > 0 && waitingInQueue.length === 0 && (
            <span className="text-sm text-slate-500">
              {queuedForParsing.length} queued for parsing
            </span>
          )}
        </div>
        {isError && onRetry && <BackendError onRetry={onRetry} />}
        {!isError && (
          <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
            <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Resume Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Uploaded At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <Loader2 size={20} className="mx-auto animate-spin text-slate-300" />
                    </td>
                  </tr>
                ) : queueCandidates.length === 0 ? (
                  <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                    <td colSpan={4} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                      No resumes in queue.
                    </td>
                  </tr>
                ) : (
                  queueCandidates.map((candidate) => {
                    const name = resumeDisplayName(candidate)
                    const isFailed = candidate.parse_status === 'parse_failed'
                    const isWaitingForSlot = candidate.parse_status === 'pending_parse'
                    return (
                      <tr key={candidate.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-3 text-sm font-medium text-slate-800">{name}</td>
                        <td className="px-6 py-3 text-sm text-slate-600">
                          {formatUploadedAt(candidate.created_at)}
                        </td>
                        <td className="px-6 py-3 text-sm text-slate-600">
                          {isFailed ? (
                            <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                              Failed
                            </span>
                          ) : isWaitingForSlot ? (
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              Waiting for slot
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                              Queued
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            {isFailed && (
                              <button
                                type="button"
                                onClick={() => retryMutation.mutate(candidate.id)}
                                disabled={retryMutation.isPending}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
                                title="Retry parse"
                              >
                                <RotateCcw size={14} />
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(candidate.id, name)}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              title="Remove"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default UploadTab
