import type { ReactNode } from 'react'
import { Text } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import { splitByScript } from '../scriptRuns.ts'
import { FONT_FAMILY, TYPE } from '../theme.ts'

const LINE_HEIGHT = 1.4

function flatStyles(style: Style | Style[] | undefined): Style[] {
  if (!style) return []
  return Array.isArray(style) ? style : [style]
}

interface Props {
  children: string | null | undefined
  style?: Style | Style[]
  /** Passed through for page-break control. */
  wrap?: boolean
  minPresenceAhead?: number
}

/**
 * Text that picks a font per writing system. react-pdf sets one font per run, so Hindi inside an
 * English sentence would otherwise print as noise: Devanagari runs are wrapped in the Noto font.
 * Text with no Devanagari renders as one plain run.
 */
export function RichText({ children, style, wrap, minPresenceAhead }: Props) {
  const text = children ?? ''
  const runs = splitByScript(text)
  const nodes: ReactNode =
    runs.length <= 1 && runs[0]?.script !== 'devanagari'
      ? text
      : runs.map((run, index) =>
          run.script === 'devanagari' ? (
            <Text key={index} style={{ fontFamily: FONT_FAMILY.deva }}>
              {run.text}
            </Text>
          ) : (
            run.text
          ),
        )
  return (
    // A unitless lineHeight is resolved against the font size on the same node (react-pdf does not
    // use the inherited one, and falls back to 18pt), so every run states both: the body size
    // unless the style gives its own.
    <Text
      style={[{ fontSize: TYPE.body, lineHeight: LINE_HEIGHT }, ...flatStyles(style)]}
      wrap={wrap}
      minPresenceAhead={minPresenceAhead}
    >
      {nodes}
    </Text>
  )
}
