import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'
import type { InterviewReport } from '@/types/api'

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

const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  hold: 'Hold',
  no_hire: 'No Hire',
  needs_review: 'Needs Review',
}

type TranscriptTurn = { speaker: string; text: string }

function parseTranscript(transcript: string): TranscriptTurn[] {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const turns: TranscriptTurn[] = []

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      turns.push({ speaker: match[1].trim(), text: match[2].trim() })
      continue
    }
    if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`
    } else {
      turns.push({ speaker: 'Transcript', text: line })
    }
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
    `Recruitment Hub · Interview Report · Page ${pageNumber} of ${totalPages}`,
    PAGE_MARGIN,
    FOOTER_Y,
  )
  doc.text(new Date().toLocaleDateString(), PAGE_MARGIN + CONTENT_WIDTH, FOOTER_Y, { align: 'right' })
}

function recommendationColor(rec?: string): [number, number, number] {
  if (rec === 'strong_hire' || rec === 'hire') return COLORS.emerald
  if (rec === 'no_hire') return COLORS.rose
  if (rec === 'hold' || rec === 'needs_review') return COLORS.amber
  return COLORS.slate
}

export function downloadInterviewReportPdf(report: InterviewReport): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const candidateName = report.candidate_name ?? 'Candidate'
  const rubricTotal = report.rubric_total ?? 100

  let y = PAGE_MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...COLORS.indigo)
  doc.text('AI Interview Report', PAGE_MARGIN, y)

  if (report.job_title) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.slate)
    doc.text(report.job_title, PAGE_MARGIN, y + 8)
    y += 8
  }
  y += 14

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(PAGE_MARGIN, y - 6, CONTENT_WIDTH, 22, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.dark)
  doc.text(candidateName, PAGE_MARGIN + 4, y + 2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.slate)
  const recLabel = RECOMMENDATION_LABEL[report.final_recommendation ?? ''] ?? report.final_recommendation ?? '—'
  doc.text(`Recommendation: ${recLabel}`, PAGE_MARGIN + 4, y + 10)
  y += 24

  if (report.overall_score != null) {
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(PAGE_MARGIN, y, 70, 28, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.slate)
    doc.text('Overall Score', PAGE_MARGIN + 4, y + 10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...recommendationColor(report.final_recommendation))
    doc.text(`${report.overall_score}/${rubricTotal}`, PAGE_MARGIN + 4, y + 22)
    y += 36
  }

  if (report.question_scores && report.question_scores.length > 0) {
    y = drawSectionTitle(doc, 'Question scores & answers', y)
    for (let i = 0; i < report.question_scores.length; i += 1) {
      const qs = report.question_scores[i]
      y = ensureSpace(doc, y, 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...COLORS.dark)
      const qLines = doc.splitTextToSize(`Q${i + 1}. ${qs.question}`, CONTENT_WIDTH - 30)
      doc.text(qLines, PAGE_MARGIN, y)
      y += qLines.length * 5 + 2
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...COLORS.indigo)
      doc.text(
        `Score: ${qs.earned_score != null ? qs.earned_score : '—'}/${qs.score}`,
        PAGE_MARGIN + CONTENT_WIDTH - 28,
        y - qLines.length * 5,
        { align: 'right' },
      )
      if (qs.candidate_answer?.trim()) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(...COLORS.slate)
        doc.text('Candidate answer:', PAGE_MARGIN, y)
        y += 4
        y = drawWrappedParagraph(doc, qs.candidate_answer.trim(), y, 2)
      }
      if (qs.notes?.trim()) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(...COLORS.slate)
        doc.text('Assessor notes:', PAGE_MARGIN, y)
        y += 4
        y = drawWrappedParagraph(doc, qs.notes.trim(), y, 2)
      }
      y += 4
    }
  } else {
    const scoreRows: [string, string][] = []
    const addScore = (label: string, value?: number) => {
      if (value != null) scoreRows.push([label, `${value}/100`])
    }
    addScore('Technical fit', report.technical_fit_score)
    addScore('Communication', report.communication_score)
    addScore('Problem solving', report.problem_solving_score)
    addScore('Experience', report.experience_score)
    addScore('Role alignment', report.role_alignment_score)
    if (scoreRows.length > 0) {
      y = drawSectionTitle(doc, 'Score breakdown', y)
      autoTable(doc, {
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        head: [['Dimension', 'Score']],
        body: scoreRows,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: COLORS.indigo, textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 92 } },
      })
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    }
  }

  if (report.strengths && report.strengths.length > 0) {
    y = drawSectionTitle(doc, 'Strengths', y)
    y = drawWrappedParagraph(doc, report.strengths.join(' • '), y)
  }
  if (report.weaknesses && report.weaknesses.length > 0) {
    y = drawSectionTitle(doc, 'Areas to improve', y)
    y = drawWrappedParagraph(doc, report.weaknesses.join(' • '), y)
  }
  if (report.summary?.trim()) {
    y = drawSectionTitle(doc, 'Executive summary', y)
    y = drawWrappedParagraph(doc, report.summary.trim(), y)
  }
  if (report.jd_fit?.trim()) {
    y = drawSectionTitle(doc, 'JD fit', y)
    y = drawWrappedParagraph(doc, report.jd_fit.trim(), y)
  }

  if (report.transcript?.trim()) {
    y = drawSectionTitle(doc, 'Complete interview transcript', y)
    const turns = parseTranscript(report.transcript)
    if (turns.length > 0) {
      for (const turn of turns) {
        y = ensureSpace(doc, y, 14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(...COLORS.indigo)
        doc.text(turn.speaker, PAGE_MARGIN, y)
        y += 4
        y = drawWrappedParagraph(doc, turn.text, y, 2)
        y += 2
      }
    } else {
      y = drawWrappedParagraph(doc, report.transcript.trim(), y)
    }
  } else if (report.transcript_summary?.trim()) {
    y = drawSectionTitle(doc, 'Transcript summary', y)
    y = drawWrappedParagraph(doc, report.transcript_summary.trim(), y)
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    drawPageFooter(doc, page, pageCount)
  }

  doc.save(`${slugifyFilename(candidateName)}-interview-report-${exportTimestamp()}.pdf`)
}
