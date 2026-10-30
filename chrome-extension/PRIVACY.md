# Privacy: Recruit Hub Interview Check

## Why the `management` permission

The extension asks for one permission, `management`. It is the only way Chrome
lets an extension see which other extensions are installed and whether they are
enabled. It is used for one purpose: to check whether a prohibited AI-assistance
extension is enabled before an interview.

## What is inspected

For each installed extension, locally and in memory: its ID and its enabled
state, to compare against the blocklist in `blocklist.js`. The extension does
not read browsing history, page contents, tabs, screenshots, screen
recordings, cookies, or the contents of other extensions.

## What is stored and sent

- **Nothing is stored.** There is no `storage` permission, no cookies, no files
  written.
- **Nothing is transmitted.** This version makes no network requests and has no
  backend. The full list of installed extensions is never kept or exposed.
- The result of a scan (completed or not, time, blocklist version, any enabled
  matches with their names) is shown in the popup and discarded when it closes.
  Only blocklist matches are ever part of a result.

## Control

The extension never disables, removes, or modifies other extensions. The user
does that manually at `chrome://extensions`.

## Limitations

- It checks a fixed list of known extension IDs. It does not detect all AI tools,
  and it cannot guarantee that no AI assistance is happening.
- It sees only the current Chrome profile.
- It can be disabled or not installed by the user.

## Policy and reporting

When the interview page supplies a detection policy, the extension scores each enabled
extension's name, description, declared permissions and homepage locally. Only extensions
that are blocked or flagged are returned to the page (with the signals that flagged them),
and the page records them against the interview so the hiring team can review them. Each flagged
extension is reported with its own name and description (public store text, trimmed to 300
characters) so the hiring organization's administrators can decide whether to add it to their blocklist; that
catalog is kept per organization and holds no candidate or interview information. The
full list of installed extensions is never returned or stored.

## Website access

Only the Recruit Hub candidate app origins listed in `manifest.json` can ask the
extension for a scan. A page receives the scan result only: whether the scan
completed, the time, the blocklist version, and the names of any enabled
prohibited extensions. It never receives the list of installed extensions.
