import type { ReactNode } from 'react'
import { Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_FAMILY, PAGE, TYPE } from '../theme.ts'

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE.margin,
    paddingHorizontal: PAGE.margin,
    paddingBottom: PAGE.margin + PAGE.footerReserve,
    fontFamily: FONT_FAMILY.sans,
    fontSize: TYPE.body,
    color: COLORS.ink,
  },
  footer: {
    position: 'absolute',
    left: PAGE.margin,
    right: PAGE.margin,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.75,
    borderTopColor: COLORS.line,
    paddingTop: 6,
    fontSize: TYPE.micro,
    color: COLORS.inkSubtle,
  },
})

interface Props {
  /** "Interview Report" in "Recruitment Hub · Interview Report · Page 2 of 4". */
  footerTitle: string
  /** The date printed at the right of the footer. */
  footerDate: string
  children: ReactNode
}

/** An A4 page whose footer sits on every page it spills onto, with "Page x of y". */
export function PdfPage({ footerTitle, footerDate, children }: Props) {
  return (
    <Page size="A4" style={styles.page}>
      {children}
      <View fixed style={styles.footer}>
        <Text>Recruitment Hub · {footerTitle}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        <Text>{footerDate}</Text>
      </View>
    </Page>
  )
}
