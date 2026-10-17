/**
 * Popup UI. Presentation only: scanning and matching live in inventory.js and
 * blocklist.js, reached through the service worker so the popup and a future
 * website integration share one code path.
 */

import { isClean } from './inventory.js'

const STATES = ['idle', 'scanning', 'clean', 'warning', 'error']

function show(name) {
  for (const state of STATES) {
    document.getElementById(`state-${state}`).hidden = state !== name
  }
}

function sendScan() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'RH_SCAN' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (!response) {
        reject(new Error('No response from the extension service worker.'))
      } else {
        resolve(response)
      }
    })
  })
}

function renderFound(extensions) {
  const list = document.getElementById('found')
  list.replaceChildren()
  for (const ext of extensions) {
    const item = document.createElement('li')
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = ext.name
    const why = document.createElement('div')
    why.className = 'why'
    why.textContent = ext.reason
    item.append(name, why)
    list.append(item)
  }
}

async function scan() {
  show('scanning')
  let result
  try {
    result = await sendScan()
  } catch (err) {
    document.getElementById('error-message').textContent = err.message
    show('error')
    return
  }

  document.getElementById('version').textContent = result.blocklist_version
  if (result.error || !result.scan_completed) {
    document.getElementById('error-message').textContent =
      result.error?.message ?? 'The scan did not complete.'
    show('error')
  } else if (isClean(result)) {
    document.getElementById('clean-meta').textContent =
      `Checked ${new Date(result.checked_at).toLocaleTimeString()}.`
    show('clean')
  } else {
    renderFound(result.prohibited_extensions)
    show('warning')
  }
}

document.getElementById('scan').addEventListener('click', scan)
for (const button of document.querySelectorAll('.rescan')) {
  button.addEventListener('click', scan)
}
