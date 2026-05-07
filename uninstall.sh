#!/bin/zsh
set -euo pipefail
cat <<'EOF'
Uninstall is intentionally conservative.

Manual rollback path:
  1. Inspect ~/.claude/installer-backups/openrouter-lts-*
  2. Restore desired files manually
  3. Run: launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist

This repo does not auto-delete Claude Code setup yet.
EOF
