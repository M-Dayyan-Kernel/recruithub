/**
 * Splits text into runs by writing system, so each run can be set in a font that has its glyphs.
 *
 * react-pdf applies one font per text run and has no per-glyph fallback: Hindi in Inter prints as
 * boxes or noise. Devanagari gets its own run; everything else stays in the default (Latin) font.
 * Spaces, digits and punctuation take the script of the run before them (Latin at the start of the
 * text), so a line is not chopped into one run per space.
 */

export type Script = 'latin' | 'devanagari'

export interface TextRun {
  text: string
  script: Script
}

// The Devanagari block holds the letters, signs and the danda; ZWJ and ZWNJ shape conjuncts.
const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/
const JOINERS = /[‌‍]/

function isLetterLike(ch: string): boolean {
  return /[\p{L}\p{M}]/u.test(ch)
}

function scriptOf(ch: string): Script | null {
  if (DEVANAGARI.test(ch)) return 'devanagari'
  if (JOINERS.test(ch)) return null
  return isLetterLike(ch) ? 'latin' : null
}

export function splitByScript(text: string): TextRun[] {
  if (!text) return []
  const chars = Array.from(text)
  const scripts = chars.map(scriptOf)

  // Neutral characters (spaces, digits, punctuation, joiners) follow the script before them.
  let previous: Script = 'latin'
  const resolved = scripts.map((s) => {
    if (s) previous = s
    return previous
  })

  const runs: TextRun[] = []
  chars.forEach((ch, i) => {
    const script = resolved[i]
    const last = runs[runs.length - 1]
    if (last && last.script === script) last.text += ch
    else runs.push({ text: ch, script })
  })
  return runs
}

/** True when any of the text needs the Devanagari font. */
export function hasDevanagari(text: string | null | undefined): boolean {
  return !!text && DEVANAGARI.test(text)
}
