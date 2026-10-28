import { Font } from '@react-pdf/renderer'
import { FONT_FAMILY } from './theme.ts'
import inter400 from '../../assets/fonts/Inter-400Regular.ttf?url'
import inter500 from '../../assets/fonts/Inter-500Medium.ttf?url'
import inter600 from '../../assets/fonts/Inter-600SemiBold.ttf?url'
import inter700 from '../../assets/fonts/Inter-700Bold.ttf?url'
import deva400 from '../../assets/fonts/NotoSansDevanagari-400Regular.ttf?url'
import deva700 from '../../assets/fonts/NotoSansDevanagari-700Bold.ttf?url'
import mono400 from '../../assets/fonts/JetBrainsMono-400Regular.ttf?url'
import mono500 from '../../assets/fonts/JetBrainsMono-500Medium.ttf?url'

let registered = false

/**
 * Registers the report fonts once. Every weight a report uses must be listed here: react-pdf has no
 * synthetic bold and fails on a weight that was never registered. They are static TTFs (variable
 * fonts are not reliable in react-pdf), subset to what the reports print; see
 * src/assets/fonts/README.md for how to regenerate them.
 */
export function registerPdfFonts(): void {
  if (registered) return
  Font.register({
    family: FONT_FAMILY.sans,
    fonts: [
      { src: inter400, fontWeight: 400 },
      { src: inter500, fontWeight: 500 },
      { src: inter600, fontWeight: 600 },
      { src: inter700, fontWeight: 700 },
    ],
  })
  Font.register({
    family: FONT_FAMILY.deva,
    fonts: [
      { src: deva400, fontWeight: 400 },
      { src: deva700, fontWeight: 700 },
      // Not used, but a weight asked for between the two must resolve rather than fail.
      { src: deva400, fontWeight: 500 },
      { src: deva700, fontWeight: 600 },
    ],
  })
  Font.register({
    family: FONT_FAMILY.mono,
    fonts: [
      { src: mono400, fontWeight: 400 },
      { src: mono500, fontWeight: 500 },
      { src: mono500, fontWeight: 600 },
      { src: mono500, fontWeight: 700 },
    ],
  })
  // Words and names are never broken with hyphens; Indic text does not hyphenate this way at all.
  Font.registerHyphenationCallback((word) => [word])
  registered = true
}
