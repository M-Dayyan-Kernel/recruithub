import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'
import type { ScreeningCall, ScreeningResult } from '@/types/api'

const PAGE_MARGIN = 14
const CONTENT_WIDTH = 182
const FOOTER_Y = 285

const COLORS = {
  indigo: [79, 70, 229] as [number, number, number],
  slate: [100, 116, 139] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
  emerald: [16, 185, 129] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  rose: [244, 63, 94] as [number, number, number],
}

const RESULT_LABEL: Record<ScreeningResult, string> = {
  pass: 'Passed',
  fail: 'Failed',
  needs_review: 'Needs review',
}

const RESULT_COLOR: Record<ScreeningResult, [number, number, number]> = {
  pass: COLORS.emerald,
  fail: COLORS.rose,
  needs_review: COLORS.amber,
}

type TranscriptTurn = { speaker: 'ai' | 'candidate' | 'unknown'; text: string }

function formatCallDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function humanizeEndedReason(reason: string): string {
  return reason.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseTranscript(transcript: string): TranscriptTurn[] {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const turns: TranscriptTurn[] = []

  for (const line of lines) {
    const aiMatch = line.match(/^(?:AI|Assistant|Agent|Bot)\s*[:|-]\s*(.+)$/i)
    const userMatch = line.match(/^(?:User|Customer|Candidate|Human)\s*[:|-]\s*(.+)$/i)
    if (aiMatch) {
      turns.push({ speaker: 'ai', text: aiMatch[1].trim() })
      continue
    }
    if (userMatch) {
      turns.push({ speaker: 'candidate', text: userMatch[1].trim() })
      continue
    }
    if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`
    } else {
      turns.push({ speaker: 'unknown', text: line })
    }
  }

  if (turns.length === 0 && transcript.trim()) {
    return [{ speaker: 'unknown', text: transcript.trim() }]
  }
  return turns
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > FOOTER_Y - 10) {
    doc.addPage()
    return PAGE_MARGIN + 8
  }
  return y
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  y = ensureSpace(doc, y, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.dark)
  doc.text(title.toUpperCase(), PAGE_MARGIN, y)
  doc.setDrawColor(226, 232, 240)
  doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + CONTENT_WIDTH, y + 2)
  return y + 10
}

function drawWrappedParagraph(doc: jsPDF, text: string, y: number, indent = 0): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent)
  y = ensureSpace(doc, y, lines.length * 5 + 4)
  doc.text(lines, PAGE_MARGIN + indent, y)
  return y + lines.length * 5 + 6
}

function drawPageFooter(doc: jsPDF, pageNumber: number, totalPages: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.slate)
  doc.text(
    `Recruitment Hub · AI Screening Report · Page ${pageNumber} of ${totalPages}`,
    PAGE_MARGIN,
    FOOTER_Y,
  )
  doc.text(new Date().toLocaleDateString(), PAGE_MARGIN + CONTENT_WIDTH, FOOTER_Y, { align: 'right' })
}

function willingnessLabel(value: boolean | null | undefined): string | null {
  if (value === true) return 'Interested'
  if (value === false) return 'Not interested'
  return null
}

export interface ScreeningReportPdfOptions {
  candidateName?: string
  phone?: string | null
  jobTitle?: string
  attemptNumber?: number
}

export function downloadScreeningReportPdf(
  call: ScreeningCall,
  options?: ScreeningReportPdfOptions,
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const resultKey: ScreeningResult = call.result ?? 'needs_review'
  const candidateName = options?.candidateName ?? 'Candidate'

  let y = PAGE_MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...COLORS.indigo)
  doc.text('AI Screening Report', PAGE_MARGIN, y)

  if (options?.jobTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.slate)
    doc.text(options.jobTitle, PAGE_MARGIN, y + 8)
    y += 8
  }
  y += 14

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(PAGE_MARGIN, y - 6, CONTENT_WIDTH, 26, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.dark)
  doc.text(candidateName, PAGE_MARGIN + 4, y + 2)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.slate)
  const metaParts = [
    options?.phone?.trim() || null,
    formatCallDate(call.created_at),
    options?.attemptNumber != null ? `Attempt ${options.attemptNumber}` : null,
    call.ended_reason ? humanizeEndedReason(call.ended_reason) : null,
  ].filter(Boolean)
  if (metaParts.length > 0) {
    doc.text(metaParts.join('  ·  '), PAGE_MARGIN + 4, y + 10)
  }
  y += 22

  const metrics = [
    { label: 'Screening result', value: RESULT_LABEL[resultKey], color: RESULT_COLOR[resultKey] },
    {
      label: 'Willingness',
      value: willingnessLabel(call.willingness_to_proceed) ?? '—',
      color: COLORS.slate,
    },
    {
      label: 'Communication',
      value: call.communication_quality
        ? call.communication_quality.charAt(0).toUpperCase() + call.communication_quality.slice(1)
        : '—',
      color: COLORS.indigo,
    },
  ]

  const metricWidth = CONTENT_WIDTH / 3
  metrics.forEach((metric, index) => {
    const x = PAGE_MARGIN + index * metricWidth
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, y, metricWidth - 4, 24, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.slate)
    doc.text(metric.label, x + 4, y + 8)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...metric.color)
    doc.text(metric.value, x + 4, y + 18)
  })
  y += 32

  if (call.summary?.trim()) {
    y = drawSectionTitle(doc, 'AI Summary', y)
    y = drawWrappedParagraph(doc, call.summary.trim(), y)
  }

  const detailRows: [string, string][] = []
  const addRow = (label: string, value?: string | null) => {
    if (value?.trim()) detailRows.push([label, value.trim()])
  }

  addRow('Relevant experience', call.relevant_experience)
  addRow('Employment status', call.employment_status)
  addRow('Location preference', call.location_preference)
  addRow('Availability to join', call.availability)
  addRow('Notice period', call.notice_period)
  addRow('Current CTC', call.current_ctc)
  addRow('Expected CTC', call.expected_ctc)

  if (detailRows.length > 0) {
    y = drawSectionTitle(doc, 'Screening details', y)
    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [['Field', 'Response']],
      body: detailRows,
      styles: {
        fontSize: 9,
        cellPadding: 3,
        textColor: COLORS.dark,
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: COLORS.indigo,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 52, fontStyle: 'bold', textColor: COLORS.slate },
        1: { cellWidth: 130 },
      },
    })
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  if (call.transcript?.trim()) {
    y = drawSectionTitle(doc, 'Call transcript', y)
    const turns = parseTranscript(call.transcript)

    for (const turn of turns) {
      const speakerLabel =
        turn.speaker === 'ai'
          ? 'AI Screener'
          : turn.speaker === 'candidate'
            ? 'Candidate'
            : 'Transcript'
      y = ensureSpace(doc, y, 16)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.indigo)
      doc.text(speakerLabel, PAGE_MARGIN, y)
      y += 4
      y = drawWrappedParagraph(doc, turn.text, y, 2)
      y += 2
    }
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    drawPageFooter(doc, page, pageCount)
  }

  const filename = `${slugifyFilename(candidateName)}-screening-report-${exportTimestamp()}.pdf`
  doc.save(filename)
}
