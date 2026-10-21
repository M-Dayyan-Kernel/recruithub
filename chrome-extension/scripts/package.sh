#!/bin/sh
# Packages the extension for sideloading ("Load unpacked") and writes a small
# descriptor next to it.
#
#   sh scripts/package.sh <extension-dir> <out-dir>
#
# Used by the candidate-app Docker build (so the zip served to candidates is
# always built from the source in the same commit) and by developers via
# `npm run package`. There is deliberately one implementation: a committed zip
# goes stale, and this repo already had one that was two releases behind.
#
# Files sit at the zip ROOT, not inside a folder. Windows "Extract all" creates a
# folder named after the zip; a top-level folder inside it would nest
# manifest.json one level too deep and Chrome reports "Manifest file is missing".
#
# Everything ships except the deny list below. A deny list is chosen over an
# allow list on purpose: a new runtime file ships automatically, whereas a
# forgotten allow-list entry would produce an extension that fails to load.
set -eu

SRC="${1:?usage: package.sh <extension-dir> <out-dir>}"
OUT="${2:?usage: package.sh <extension-dir> <out-dir>}"
NAME="rh-interview-check"

command -v zip >/dev/null 2>&1 || { echo "package.sh: 'zip' is not installed" >&2; exit 1; }
[ -f "$SRC/manifest.json" ] || { echo "package.sh: no manifest.json in $SRC" >&2; exit 1; }

# POSIX sed only: this runs in a bare alpine image with no node or jq.
version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -n 1)"
[ -n "$version" ] || { echo "package.sh: no version in manifest.json" >&2; exit 1; }

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
zipfile="$OUT/$NAME.zip"
rm -f "$zipfile" "$OUT/latest.json"

(
  cd "$SRC"
  zip -qrX "$zipfile" . \
    -x 'tests/*' 'scripts/*' 'dist/*' 'node_modules/*' \
       'README.md' 'package.json' 'package-lock.json' '*.zip' '.*'
)

if command -v sha256sum >/dev/null 2>&1; then
  sha256="$(sha256sum "$zipfile" | cut -d ' ' -f 1)"
else
  sha256="$(shasum -a 256 "$zipfile" | cut -d ' ' -f 1)"
fi
bytes="$(wc -c < "$zipfile" | tr -d ' ')"

# Read by the candidate app to show the version and checksum. Optional there:
# if this file is missing the install guide still works.
printf '{"name":"%s","version":"%s","file":"%s.zip","sha256":"%s","bytes":%s}\n' \
  "$NAME" "$version" "$NAME" "$sha256" "$bytes" > "$OUT/latest.json"

echo "package.sh: wrote $zipfile (v$version, $bytes bytes)"
