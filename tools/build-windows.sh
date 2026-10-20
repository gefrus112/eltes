#!/usr/bin/env bash
# Rebuild downloads/eltes-windows.zip from the current working tree.
# Usage: bash tools/build-windows.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
DEST="$STAGE/eltes-windows"
mkdir -p "$DEST"
cd "$ROOT"
cp index.html app.html auth.html docs.html 404.html site.webmanifest README.md LICENSE NOTICE.md "$DEST/"
cp -r assets "$DEST/"
cp tools/windows/eltes.bat tools/windows/Start-Eltes.ps1 tools/windows/README-WINDOWS.txt "$DEST/"
mkdir -p downloads
rm -f downloads/eltes-windows.zip
(cd "$STAGE" && zip -qr9 "$ROOT/downloads/eltes-windows.zip" eltes-windows)
rm -rf "$STAGE"
ls -lh downloads/eltes-windows.zip
