import type { ReactNode } from 'react'
import { Document } from '@react-pdf/renderer'

interface Props {
  title: string
  subject?: string
  children: ReactNode
}

/** The PDF's own metadata (title shows in the viewer's tab) around its pages. */
export function PdfDocument({ title, subject, children }: Props) {
  return (
    <Document title={title} subject={subject} author="Recruitment Hub" creator="Recruitment Hub">
      {children}
    </Document>
  )
}
