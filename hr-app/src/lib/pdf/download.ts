import type { ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { pdf } from '@react-pdf/renderer'
import { registerPdfFonts } from './fonts.ts'

/**
 * Renders a report to a PDF and hands it to the browser as a download.
 *
 * Layout runs on the main thread, so a very large document can pause the page for a moment: the
 * callers show a busy state and let the browser paint it first (see `yieldToBrowser`).
 */
export async function downloadPdf(document: ReactElement, filename: string): Promise<void> {
  registerPdfFonts()
  // The report components render a <Document> themselves; react-pdf's type only knows the bare one.
  const blob = await pdf(document as ReactElement<DocumentProps>).toBlob()
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = filename
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Lets the browser paint a spinner before a long synchronous render starts. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
