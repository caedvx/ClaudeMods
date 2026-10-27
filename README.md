# Claude Code mods

Three mods for Claude Code, plus an optional editor sidebar. Works on macOS and Linux.

| Mod | What it does |
|---|---|
| `commit-guard` | Strips `Co-Authored-By: Claude` and "Generated with Claude Code" lines from `git commit` and `gh pr create/edit` |
| `session-stats` | `/session-stats` pane: tool calls, files edited, tokens, cost. Warns when a fresh chat would be cheaper (context grown, prompt cache expired). `/handoff` writes notes for continuing in a new chat |
| `usage-pace` | Status line + `/usage-pace` pane comparing rate-limit % used against % of the window elapsed. Toasts when you're well ahead of pace |

## Requirements

Claude Code **2.1.310 or newer**. Older versions silently ignore mods.

    claude update
    claude --version

## Install

    git clone <this repo> claude-mods
    cd claude-mods
    ./install.sh

That copies the mods into `~/.claude/mods/` and adds them to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (a backup is saved as `settings.json.bak`). Restart Claude Code.

Only some of them:

    ./install.sh session-stats usage-pace

Don't want commit-guard? Leave it out. It removes Claude attribution from every commit and PR you make through Claude Code.

The script needs `node` or `jq` to edit settings.json (macOS 15+ ships `/usr/bin/jq`). With neither, it prints the line to add by hand.

## Update

    git pull && ./install.sh

## Editor sidebar (optional)

VS Code's Claude panel doesn't draw mod panes, so `extension/` holds a small extension that shows session-stats and usage-pace as a "Stats" view under the Claude sidebar, plus local token usage and API-price cost across all sessions.

    ./install-extension.sh

Finds `code`, `codium` or `cursor`, including the copies inside `/Applications`. Otherwise use Extensions > ... > Install from VSIX and pick `extension/claude-stats.vsix`.

Rebuild after changing it:

    cd extension
    npx @vscode/vsce@3.2.1 package --allow-missing-repository --skip-license -o claude-stats.vsix

## Develop

    claude plugin validate mods/session-stats
    claude plugin test mods/session-stats

Edit in `mods/`, then re-run `./install.sh`. The mods find `~/.claude` relative to their own folder, so they must be copied into `~/.claude/mods/<name>`, not symlinked.
