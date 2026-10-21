import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { GhostButton, TextButton } from '@/components/Shell'
import {
  EXTENSIONS_PAGE,
  formatBytes,
  loadDescriptor,
  type ExtensionDescriptor,
} from '@/lib/extensionInstall'

/**
 * Step-by-step sideload instructions, shown while the extension is not on the
 * Chrome Web Store (see lib/extensionInstall.ts). Used by both the pre-flight
 * step and the final-check recovery card so the two cannot drift apart.
 */

function startDownload(url: string) {
  // A programmatic anchor keeps the neutral GhostButton primitive; a button inside
  // an <a> is invalid HTML and a styled <a> would fork the button classes.
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.append(a)
  a.click()
  a.remove()
}

export function ExtensionInstallGuide({ zipUrl }: { zipUrl: string }) {
  // undefined while loading, null when this deployment has no zip to offer.
  const [descriptor, setDescriptor] = useState<ExtensionDescriptor | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void loadDescriptor().then((d) => {
      if (live) setDescriptor(d)
    })
    return () => {
      live = false
    }
  }, [])

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(EXTENSIONS_PAGE)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // The address is on screen; there is nothing else to do.
    }
  }

  return (
    <div className="mb-4 rounded-[9px] border border-line bg-panel px-4 py-4 text-left">
      <p className="text-[0.9rem] font-semibold text-ink">Install it in a few steps</p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-[0.86rem] leading-relaxed text-ink">
        <li>
          Download the extension.
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {descriptor ? (
              <>
                <GhostButton onClick={() => startDownload(zipUrl)}>
                  <Download size={16} aria-hidden /> Download (.zip)
                </GhostButton>
                <span
                  className="font-mono text-[0.75rem] tabular-nums text-ink-muted"
                  title={`SHA-256 ${descriptor.sha256}`}
                >
                  v{descriptor.version} · {formatBytes(descriptor.bytes)}
                </span>
              </>
            ) : descriptor === null ? (
              <span className="text-[0.82rem] text-ink-muted">
                The download is not available right now. Please contact the hiring team.
              </span>
            ) : (
              <span className="text-[0.82rem] text-ink-muted">Preparing the download…</span>
            )}
          </div>
        </li>
        <li>Unzip it into a folder you can find, such as Documents.</li>
        <li>
          Open a new tab and go to{' '}
          <span className="font-mono text-[0.8rem]">{EXTENSIONS_PAGE}</span>.
          <div className="mt-1">
            <TextButton onClick={() => void copyAddress()}>
              {copied ? 'Copied' : 'Copy address'}
            </TextButton>
          </div>
        </li>
        <li>
          Turn on <strong className="font-semibold">Developer mode</strong> (top right), choose{' '}
          <strong className="font-semibold">Load unpacked</strong>, and select the unzipped folder
          that contains <span className="font-mono text-[0.8rem]">manifest.json</span>.
        </li>
        <li>Come back to this page and choose Check again.</li>
      </ol>
      <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-muted">
        If Chrome says the manifest file is missing, you selected the wrong folder level. Chrome
        may also ask you to turn off developer mode extensions when it starts; leave this one on.
      </p>
    </div>
  )
}
