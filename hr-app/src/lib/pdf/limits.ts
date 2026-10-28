/**
 * How many candidates one bulk shortlist PDF may hold. react-pdf lays a document out on the main
 * thread, at about 30 ms per candidate (measured in Node: 50 candidates 1.7 s, 150 candidates
 * 4.5 s, 300 candidates 7.9 s; a browser is slower), so a large export pauses the page.
 */
export const BUNDLE_NOTICE_AT = 50
export const BUNDLE_MAX = 200

export type BundleCheck = { ok: true; slow: boolean } | { ok: false; message: string }

export function checkBundleSize(count: number): BundleCheck {
  if (count > BUNDLE_MAX) {
    return {
      ok: false,
      message: `A PDF can hold up to ${BUNDLE_MAX} reports. Filter the list to fewer than ${BUNDLE_MAX} and export again.`,
    }
  }
  return { ok: true, slow: count > BUNDLE_NOTICE_AT }
}
