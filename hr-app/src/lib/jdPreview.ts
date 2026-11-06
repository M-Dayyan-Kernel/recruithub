/**
 * How an uploaded job description can be previewed. A browser shows a PDF itself, but not a Word
 * file, so a PDF gets its real pages and everything else is shown as the text read from it.
 */

export type JdPreviewKind = 'pdf' | 'text'

export function jdPreviewKind(file: { name: string; type?: string }): JdPreviewKind {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text'
}

/** "840 KB", "1.2 MB": a file size a person can read. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
