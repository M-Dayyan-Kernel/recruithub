/**
 * Plain-language wording for the machine signals recorded with a flagged
 * extension, so a recruiter reads "can capture tab audio and video" rather than
 * "permission:tabCapture". Dependency-free so it can be unit tested.
 */

const PERMISSION_LABEL: Record<string, string> = {
  tabCapture: 'can capture tab audio and video',
  desktopCapture: 'can capture the screen',
  sidePanel: 'has a side panel',
  offscreen: 'can run a hidden page',
  scripting: 'can inject scripts',
  activeTab: 'can read the active tab',
}

export function describeSignal(signal: string): string {
  if (signal === 'broad_host') return 'can run on every website'
  if (signal === 'known_id') return 'matched the known list'
  if (signal === 'cannot_be_disabled') return 'installed by device policy; could not be turned off'
  const [kind, ...rest] = signal.split(':')
  const value = rest.join(':')
  if (kind === 'keyword') return `mentions "${value}"`
  if (kind === 'host') return `can reach ${value}`
  if (kind === 'homepage') return `homepage on ${value}`
  if (kind === 'permission') return PERMISSION_LABEL[value] ?? `permission ${value}`
  return signal
}
