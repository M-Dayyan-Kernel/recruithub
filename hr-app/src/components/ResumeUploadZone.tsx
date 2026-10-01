import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Loader2, AlertCircle, FileText, Archive } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  jobId: string
  onUploadSuccess?: (createdIds: string[]) => void
  variant?: 'default' | 'compact' | 'pipeline'
  disabled?: boolean
}

const FILE_BADGES = ['PDF', 'DOCX', 'ZIP'] as const

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

  const isPipeline = variant === 'pipeline'
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
      const result = (await api.post(`/api/jobs/${jobId}/resumes`, formData, {
        timeout: 180_000,
      })) as {
        created: number
        skipped_oversized?: string[]
        candidate_ids?: string[]
      }
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
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

  const dropZoneClass = cn(
    'relative transition-all duration-200',
    isPipeline
      ? 'rounded-xl border-2 border-dashed px-4 py-3.5 sm:px-5 sm:py-4'
      : cn('rounded-lg border-2 border-dashed text-center', isCompact ? 'p-4' : 'p-8'),
    disabled &&
      'cursor-not-allowed border-slate-200/80 bg-slate-100/80 opacity-70',
    !disabled &&
      (isUploading
        ? 'pointer-events-none border-indigo-200 bg-indigo-50/70'
        : isDragOver
          ? cn(
              'cursor-copy border-indigo-400 bg-indigo-50/60',
              isPipeline && 'scale-[1.005] shadow-sm ring-2 ring-indigo-100',
            )
          : cn(
              'cursor-pointer border-slate-200/90 bg-white/60',
              isPipeline
                ? 'hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm'
                : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40',
            )),
  )

  const pipelineContent = (
    <div className="flex items-center gap-3.5 sm:gap-4">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 transition-colors sm:h-11 sm:w-11',
          disabled
            ? 'bg-slate-100 text-slate-400 ring-slate-200/80'
            : isDragOver
              ? 'bg-indigo-100 text-indigo-600 ring-indigo-200/80'
              : 'bg-white text-indigo-500 ring-slate-200/80',
        )}
      >
        {disabled ? (
          <Archive size={18} />
        ) : isUploading ? (
          <Loader2 size={18} className="animate-spin text-indigo-600" />
        ) : (
          <Upload size={18} />
        )}
      </div>

      <div className="min-w-0 flex-1 text-left">
        {isUploading ? (
          <>
            <p className="text-sm font-medium text-indigo-700">
              Uploading {uploadCount} file{uploadCount !== 1 ? 's' : ''}…
            </p>
            <p className="mt-0.5 text-xs text-indigo-500/80">AI review starts automatically</p>
          </>
        ) : disabled ? (
          <>
            <p className="text-sm font-medium text-slate-600">Uploads disabled</p>
            <p className="mt-0.5 text-xs text-slate-400">This job is archived — reopen it to add resumes</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-800">
              {isDragOver ? 'Drop resumes to upload' : 'Add candidate resumes'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Drag &amp; drop here, or{' '}
              <span className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2">
                browse files
              </span>
              {' · '}AI scores against this job automatically
            </p>
          </>
        )}
      </div>

      {!disabled && !isUploading && (
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {FILE_BADGES.map((ext) => (
            <span
              key={ext}
              className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
            >
              {ext}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const defaultContent = (
    <>
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
          <div
            className={cn(
              'mx-auto flex items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm ring-1 ring-slate-200/80',
              isCompact ? 'mb-2 h-9 w-9' : 'mb-3 h-11 w-11',
            )}
          >
            <Upload size={isCompact ? 18 : 20} />
          </div>
          <p className={cn('font-medium text-slate-700', isCompact ? 'text-xs' : 'text-sm')}>
            Drag &amp; drop resumes here, or{' '}
            <span className="text-indigo-600 underline decoration-indigo-200 underline-offset-2">
              click to browse
            </span>
          </p>
          <p className={cn('text-slate-400', isCompact ? 'mt-0.5 text-[11px]' : 'mt-1.5 text-xs')}>
            PDF, DOCX, and ZIP — AI scores automatically
          </p>
        </>
      )}
    </>
  )

  return (
    <div className={cn('space-y-2', isPipeline ? 'w-full' : isCompact && 'w-full sm:max-w-md')}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={disabled ? 'Resume upload disabled' : 'Upload resumes'}
        aria-disabled={disabled || isUploading}
        onClick={() => isInteractive && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && isInteractive) {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
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
        className={dropZoneClass}
      >
        {isPipeline ? pipelineContent : defaultContent}
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
          className="sr-only"
        />
      </div>

      {isPipeline && !disabled && !isUploading && (
        <div className="flex items-center gap-1.5 px-1 sm:hidden">
          <FileText size={12} className="shrink-0 text-slate-400" />
          <p className="text-[11px] text-slate-400">PDF · DOCX · ZIP · up to 20 MB each</p>
        </div>
      )}

      {fileError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700 sm:text-sm">{fileError}</p>
        </div>
      )}
    </div>
  )
}

export default ResumeUploadZone
