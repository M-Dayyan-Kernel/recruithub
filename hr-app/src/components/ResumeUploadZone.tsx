import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  jobId: string
  onUploadSuccess?: (createdIds: string[]) => void
  variant?: 'default' | 'compact'
  disabled?: boolean
}

export function ResumeUploadZone({
  jobId,
  onUploadSuccess,
  variant = 'default',
  disabled = false,
}: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadCount, setUploadCount] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)

  const isCompact = variant === 'compact'
  const isInteractive = !isUploading && !disabled

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return
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
      const result = (await api.post(`/api/jobs/${jobId}/resumes`, formData)) as {
        created: number
        skipped_oversized?: string[]
        candidate_ids?: string[]
      }
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      if (result.created > 0) {
        toast.success(
          `${result.created} resume${result.created !== 1 ? 's' : ''} queued for AI review`,
        )
        onUploadSuccess?.(result.candidate_ids ?? [])
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
    <div className={cn('space-y-3', isCompact && 'w-full sm:max-w-md')}>
      <div
        onClick={() => isInteractive && fileInputRef.current?.click()}
        onDragOver={(e: DragEvent) => {
          if (!isInteractive) return
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e: DragEvent) => {
          if (!isInteractive) return
          e.preventDefault()
          setIsDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'relative rounded-lg border-2 border-dashed text-center transition-colors',
          isCompact ? 'p-4' : 'p-8',
          disabled && 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60',
          !disabled &&
            (isUploading
              ? 'pointer-events-none border-indigo-300 bg-indigo-50'
              : isDragOver
                ? 'cursor-copy border-indigo-400 bg-indigo-50'
                : 'cursor-pointer border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40'),
        )}
      >
        {isUploading ? (
          <div className="flex flex-col items-center justify-center">
            <Loader2
              size={isCompact ? 20 : 24}
              className={cn('animate-spin text-indigo-600', isCompact ? 'mb-1.5' : 'mb-2')}
            />
            <p className={cn('font-medium text-indigo-700', isCompact ? 'text-xs' : 'text-sm')}>
              Uploading {uploadCount} file{uploadCount !== 1 ? 's' : ''}…
            </p>
          </div>
        ) : (
          <>
            <Upload
              size={isCompact ? 20 : 24}
              className={cn('mx-auto text-slate-400', isCompact ? 'mb-1.5' : 'mb-2')}
            />
            <p className={cn('font-medium text-slate-700', isCompact ? 'text-xs' : 'text-sm')}>
              Drag &amp; drop resumes here, or{' '}
              <span className="text-indigo-600">click to browse</span>
            </p>
            <p className={cn('text-slate-400', isCompact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs')}>
              PDF, DOCX, and ZIP — AI scores automatically
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.zip"
          disabled={disabled || isUploading}
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

export default ResumeUploadZone
