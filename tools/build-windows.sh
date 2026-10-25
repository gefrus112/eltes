#!/usr/bin/env bash
# Rebuild downloads/eltes-windows.zip from the current working tree.
# Usage: bash tools/build-windows.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
DEST="$STAGE/eltes-windows"
mkdir -p "$DEST"
cd "$ROOT"
cp cookie-auth.html index.html app.html auth.html docs.html video.html 404.html site.webmanifest README.md LICENSE NOTICE.md "$DEST/"
cp -r assets "$DEST/"
cp tools/windows/eltes.bat tools/windows/Start-Eltes.ps1 tools/windows/README-WINDOWS.txt "$DEST/"
cp package.json "$DEST/"
mkdir -p "$DEST/tools"
cp config.js studio.html train.html news.html "$DEST/"
cp -r mcp "$DEST/"
cp tools/studio.mjs "$DEST/tools/"
cp -r api lib "$DEST/"
cp tools/local-server.mjs tools/media-response.mjs tools/shell-runner.mjs tools/project-files.mjs "$DEST/tools/"
mkdir -p downloads
rm -f downloads/eltes-windows.zip
(cd "$STAGE" && zip -qr9 "$ROOT/downloads/eltes-windows.zip" eltes-windows)
rm -rf "$STAGE"
ls -lh downloads/eltes-windows.zip
