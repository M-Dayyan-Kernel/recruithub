export type TranscriptTurn = { speaker: 'ai' | 'candidate' | 'unknown'; text: string }

export function parseTranscript(transcript: string): TranscriptTurn[] {
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
