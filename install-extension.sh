#!/usr/bin/env bash
# Installs the ClaudeStats sidebar into VS Code, VSCodium or Cursor.
set -euo pipefail

vsix="$(cd "$(dirname "$0")" && pwd)/extension/claude-stats.vsix"

for cli in code codium cursor \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  "/Applications/VSCodium.app/Contents/Resources/app/bin/codium" \
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"; do
  if command -v "$cli" >/dev/null 2>&1 || [ -x "$cli" ]; then
    "$cli" --install-extension "$vsix" --force
    exit 0
  fi
done

echo "No editor CLI found. In the editor: Extensions > ... > Install from VSIX > $vsix" >&2
exit 1
