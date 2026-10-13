# Recruit Hub Interview Check (Chrome extension)

A standalone Manifest V3 extension that checks, on the candidate's own device,
whether a prohibited AI-assistance extension is **enabled**. It is not yet
integrated with the Recruit Hub candidate app or backend, and it does not gate
interviews.

It does not detect every AI tool and does not guarantee that no AI assistance is
possible. See [Limitations](#limitations).

## How it works

1. `inventory.js` calls `chrome.management.getAll()` (the only permission is
   `management`).
2. `blocklist.js` matches the result by **extension ID**. A match counts only if
   the extension is **enabled**.
3. The result is a `ScanResult`. The full list of installed extensions is not
   returned, stored, logged, or sent anywhere; only blocklist matches leave the
   scanner.
4. The popup (`popup.html/css/js`) shows clean / warning / error and tells the
   user to open `chrome://extensions` and disable listed extensions manually.
   The extension never disables or removes anything.

### Scan result schema

```jsonc
{
  "scan_completed": true,                    // false whenever error is set
  "checked_at": "2026-10-12T10:00:00.000Z",  // ISO-8601 UTC
  "blocklist_version": "2026-10-12.1",
  "prohibited_extensions": [                 // enabled blocklist matches only
    { "id": "...", "name": "...", "category": "...", "reason": "...", "listing_url": "..." }
  ],
  "error": null                              // or { "code": "management_unavailable" | "scan_failed", "message": "..." }
}
```

A failed scan is `scan_completed: false` with `error` set. It must never be
treated as clean. Use `isClean(result)` from `inventory.js`, which is true only
for a completed scan with no matches and no error.

## The blocklist

| Rule | Behaviour |
|---|---|
| Enabled + ID in `BLOCKLIST` | Blocks |
| Disabled + ID in `BLOCKLIST` | Allowed |
| ID not listed (including accessibility and productivity tools) | Allowed |
| ID in `INACTIVE` | Allowed. Verified listings that are deliberately not blocking (general AI sidebars, plus VoiceMeetAI and AI Interview Copilot) |

### Active entries (verified against each Chrome Web Store listing on 2026-10-12)

| Name on listing | ID |
|---|---|
| [Monica: All-In-One AI Assist & Smartest AI Agent](https://chromewebstore.google.com/detail/ofpnmcalabcbjgholdjcjblkibolbppb) | `ofpnmcalabcbjgholdjcjblkibolbppb` |
| [Final Round AI](https://chromewebstore.google.com/detail/lfbbdphejjjanjiohlmkdbapdmfoaeem) | `lfbbdphejjjanjiohlmkdbapdmfoaeem` |
| [Interview Copilot](https://chromewebstore.google.com/detail/ibdllmhlcnecbccejcjbpdldgjnohpoc) | `ibdllmhlcnecbccejcjbpdldgjnohpoc` |
| [AI Interview Helper](https://chromewebstore.google.com/detail/jkmbojgnflgmonjnpemjoidfmhjofbaa) | `jkmbojgnflgmonjnpemjoidfmhjofbaa` |
| [Interview Buddy - Your AI Interview Copilot](https://chromewebstore.google.com/detail/bankjceeoiajhanakmghlbnahahkmaic) | `bankjceeoiajhanakmghlbnahahkmaic` |

Interview Coder, LockedIn AI, Sensei AI and Parakeet AI are listed under
`PENDING_VERIFICATION`: no Chrome Web Store extension listing was found, so
there is no ID to match.

### Adding a verified prohibited extension

1. Open the extension's **Chrome Web Store listing** and copy the 32-character ID
   from its URL. Do not take IDs from third-party directories: one such
   directory attributed an unrelated extension to a real product's name.
2. Confirm the listing's name and publisher.
3. Add an entry to `BLOCKLIST` in `blocklist.js` (`id`, `name`, `category`,
   `reason`, `listing_url`, `verified_on`).
4. Bump `BLOCKLIST_VERSION`.
5. Run `npm test`. The suite checks ID format, duplicates, and `INACTIVE` overlap.

If an ID cannot be verified, put the name under `PENDING_VERIFICATION`, not in
`BLOCKLIST`.

## Load it locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `chrome-extension/` folder.
4. Pin the extension and click its icon.

If you edit files, press the reload icon on the extension card.

## Testing

### Automated (mocked, no browser)

```bash
cd chrome-extension
npm test        # runs `node --test`, which discovers tests/*.test.js (no dependencies to install)
```

These are unit tests with a stubbed `chrome.management`. They do **not** exercise
a real Chrome browser, the real `management` permission, or the popup.

### Manual (real Chrome)

1. Load unpacked (above). Click **Scan extensions**: with no listed extension
   enabled you should see the green "No prohibited extensions" state.
2. Install and enable a listed extension (e.g. Monica). Rescan: the warning
   state should name it and show the manual steps.
3. Disable it at `chrome://extensions`. Rescan: clean again.
4. Open the popup via the service worker's "Inspect views" console and check for
   errors. To see the error state, run in the service-worker console:
   `chrome.management.getAll = () => Promise.reject(new Error('x'))`, then rescan.
   (Do this on a throwaway profile.)

## Recruit Hub integration

The candidate app (`candidate-app/src/lib/extensionCheck.ts`) asks this extension
for a fresh scan before the interview can start, and again at the start action.

- Request: `{ v: 1, type: 'RH_SCAN', nonce }`. Response: `{ v: 1, nonce, result: ScanResult }`
  or `{ v: 1, nonce, error: { code } }`. Implemented in `external.js`; the
  installed inventory is never returned.
- Access is limited to the origins in `externally_connectable.matches`
  (manifest) and `ALLOWED_ORIGINS` (`external.js`); a test keeps them in sync.
  Today only `localhost` / `127.0.0.1`. **Add each production candidate-app
  origin to both** before deploying.
- `manifest.json` pins a `key`, so an unpacked install always has the ID
  `mheakijhnpcllibkkimhpbcfaifjbipj` (the candidate app's dev default). The Chrome
  Web Store assigns its own ID: set `VITE_RH_EXTENSION_ID` in the candidate app's
  production build to that ID.
- A result from the candidate's own machine is a client-side attestation, not
  proof. The backend cannot verify it.

## Limitations

- Detects only IDs on the list. Renamed, sideloaded, or differently packaged
  builds have different IDs; Edge and other stores use their own IDs.
- Sees extensions in this Chrome profile only. A second profile, another
  browser, another device, or a native application is invisible.
- Candidates can disable or uninstall this extension, or never install it.
- Assistance that involves no extension is out of scope.
- The `management` permission shows a broad warning at install time.
