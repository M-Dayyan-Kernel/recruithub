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

There are two lists, and it matters which one is in play:

| | Where it lives | Used when |
|---|---|---|
| **Live list** | The Recruit Hub backend, edited by a Super Admin (platform console, "AI extension policy") | The interview page supplies it with the scan (see "Detection policy" below). This is the normal case. |
| **Built-in list** | `blocklist.js` in this extension | Fallback only: policy fetch failed, an older page, and the popup's local "Scan" button |

The built-in list is a snapshot; admin edits do not reach it. Both match by
**extension ID** and only when the extension is **enabled**: a disabled match or an
unknown ID is allowed.

### Adding an extension

Use the Super Admin screen (no release needed). Take the ID from the extension's
own **Chrome Web Store listing URL** and confirm its name and publisher; do not take
IDs from third-party directories (one attributed an unrelated extension to a real
product's name).

Edit `blocklist.js` only to refresh the built-in fallback, then bump
`BLOCKLIST_VERSION` and run `npm test` (it checks ID format and duplicates).

Interview Coder, LockedIn AI, Sensei AI and Parakeet AI are listed under
`PENDING_VERIFICATION`: no Chrome Web Store extension listing was found, so there
is no ID to match (they are mostly desktop apps, which this cannot see).

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

## Detection policy (protocol v2)

Beyond the built-in list, the interview page can hand the extension a **policy** from
the Recruit Hub backend: the live blocklist plus heuristic rules, versioned, edited by
a Super Admin with no extension release. The extension needs no network permission for
this; the page fetches the policy and sends it in the scan request (`v: 2`).

For each *enabled* extension the extension decides, locally:

| Result | When | Effect |
|---|---|---|
| **blocked** | ID is on the list, or (enforce mode) a strong heuristic match | interview start is stopped, candidate sees the name and reason |
| **flagged** | weak heuristic match, or a strong match in shadow mode | recorded for HR, does not stop anything |
| clear | otherwise | nothing is reported |

Heuristics score two axes (see `rules.js`): **intent** (AI wording in the name or
description, access to AI vendor hosts) and **capability** (tab/desktop capture, side
panel, access to every site). Capability alone never flags; a strong match needs both.
An extension that cannot be turned off (installed by device policy) is recorded but never
blocks. Each flagged item also carries the extension's own description (trimmed to 300
characters), which feeds the Super Admin's "Seen extensions" list. Only flagged and blocked extensions leave the browser; the rest of the inventory
never does.

`npm test` includes an **evaluation corpus** (`tests/fixtures/corpus.json`) that measures
the default rules. The corpus is approximate and self-authored, so treat its numbers as a
regression guard, not as real-world accuracy: tune from real shadow-mode data.

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
