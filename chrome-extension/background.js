/**
 * Service worker.
 *
 * Two entry points, one scanner:
 *   - onMessage          this extension's own pages (the popup): { type: 'RH_SCAN' }
 *   - onMessageExternal  the Recruit Hub candidate app, via external.js
 *
 * External access is limited twice over: the manifest's
 * `externally_connectable.matches` decides which pages Chrome lets connect, and
 * external.js re-checks `sender.origin` against ALLOWED_ORIGINS. Only the
 * ScanResult leaves the extension - never the installed inventory.
 */

import { scanInstalledExtensions, scanWithPolicy } from './inventory.js'
import { handleExternalRequest } from './external.js'

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Internal pages of this extension only; ignore content scripts and other senders.
  if (sender.id !== chrome.runtime.id || sender.tab) return false
  if (!message || message.type !== 'RH_SCAN') return false

  scanInstalledExtensions().then(sendResponse)
  return true // keep the channel open for the async response
})

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleExternalRequest(message, sender, {
    scan: () => scanInstalledExtensions(),
    scanWithPolicy: (policy) => scanWithPolicy({ policy, selfId: chrome.runtime.id }),
  }).then(sendResponse)
  return true
})
