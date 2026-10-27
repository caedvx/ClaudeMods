#!/usr/bin/env bash
# Usage: ./install.sh [mod ...]   (default: all mods in ./mods)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mods_dir="$claude_dir/mods"
settings="$claude_dir/settings.json"

if [ $# -gt 0 ]; then
  mods="$*"
else
  mods="$(ls "$here/mods")"
fi

mkdir -p "$mods_dir"
dirs=""
for m in $mods; do
  [ -d "$here/mods/$m" ] || { echo "no such mod: $m" >&2; exit 1; }
  rm -rf "$mods_dir/$m"
  # Copy, don't symlink: the mods locate ~/.claude relative to their own folder.
  cp -R "$here/mods/$m" "$mods_dir/$m"
  rm -rf "$mods_dir/$m/tests"
  dirs="${dirs:+$dirs:}$mods_dir/$m"
  echo "installed $m"
done

[ -f "$settings" ] || echo '{}' > "$settings"
cp "$settings" "$settings.bak"

merge_js='
const fs = require("fs")
const [file, add] = process.argv.slice(1)
const s = JSON.parse(fs.readFileSync(file, "utf8"))
s.env = s.env || {}
const cur = (s.env.CLAUDE_CODE_PLUGIN_DIRS || "").split(":").filter(Boolean)
for (const d of add.split(":")) if (!cur.includes(d)) cur.push(d)
s.env.CLAUDE_CODE_PLUGIN_DIRS = cur.join(":")
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n")
'

if command -v node >/dev/null 2>&1; then
  node -e "$merge_js" "$settings" "$dirs"
elif command -v jq >/dev/null 2>&1; then
  tmp="$(mktemp)"
  jq --arg add "$dirs" '
    .env = (.env // {})
    | .env.CLAUDE_CODE_PLUGIN_DIRS = (
        ((.env.CLAUDE_CODE_PLUGIN_DIRS // "") | split(":") | map(select(. != ""))) as $cur
        | ($cur + (($add | split(":")) - $cur)) | join(":"))
  ' "$settings" > "$tmp" && mv "$tmp" "$settings"
else
  echo
  echo "Neither node nor jq found. Add this to the \"env\" block of $settings yourself:"
  echo "  \"CLAUDE_CODE_PLUGIN_DIRS\": \"$dirs\""
  exit 0
fi

echo "updated $settings (backup: $settings.bak)"
echo "restart Claude Code to load the mods"
