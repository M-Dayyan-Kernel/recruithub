import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { BTN_SECONDARY } from '@/components/ui/Surface'
import StageTabs from '@/components/stage/StageTabs'
import { formatFileSize, jdPreviewKind } from '@/lib/jdPreview'

type View = 'document' | 'text'

/**
 * The job description HR uploaded, to read alongside the form it filled in. A PDF shows its real
 * pages (with the text we read from it one tab over); a Word file cannot be rendered by a browser,
 * so it shows the text we read, with a download for the original. The file lives only in this page:
 * it is gone when the page is closed or the job is created.
 */
export function JdPreviewModal({ file, text, onClose }: { file: File; text: string; onClose: () => void }) {
  const kind = jdPreviewKind(file)
  const [view, setView] = useState<View>(kind === 'pdf' ? 'document' : 'text')
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  return createPortal(
    <Modal
      title={file.name}
      description={`${kind === 'pdf' ? 'PDF' : 'Word document'} · ${formatFileSize(file.size)}`}
      size="2xl"
      blur
      onClose={onClose}
      headerActions={
        <a href={url} download={file.name} className={BTN_SECONDARY}>
          <Download size={14} aria-hidden />
          Download
        </a>
      }
    >
      {kind === 'pdf' && (
        <div className="border-b border-line px-5">
          <StageTabs
            label="Preview"
            active={view}
            onChange={setView}
            tabs={[
              { id: 'document', label: 'Document' },
              { id: 'text', label: 'Text we read' },
            ]}
          />
        </div>
      )}

      {view === 'document' ? (
        <iframe title={`Preview of ${file.name}`} src={url} className="h-[70vh] w-full border-0 bg-surface-2" />
      ) : (
        <div>
          {kind === 'text' && (
            <p className="border-b border-line bg-surface-2/60 px-5 py-2.5 text-[12px] text-ink-muted">
              A browser cannot show a Word file, so this is the text read from it. Download the original to see its
              formatting.
            </p>
          )}
          {text.trim() ? (
            <pre className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words p-5 font-sans text-sm leading-relaxed text-ink">
              {text}
            </pre>
          ) : (
            <p className="px-5 py-12 text-center text-sm text-ink-muted">No text could be read from this file.</p>
          )}
        </div>
      )}
    </Modal>,
    document.body,
  )
}
