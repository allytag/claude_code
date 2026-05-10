# Linux Support

Status: **Beta**.

Linux support is isolated under `platforms/linux` and does not change the macOS LTS installer.

## Requirements

- Linux x86_64 or arm64
- Node.js >= 20
- Official Claude Code CLI already installed
- `~/.local/bin` in `PATH`
- `systemd --user` for automatic proxy startup
- VS Code optional

## Dry Run

```sh
node platforms/linux/install.mjs --dry-run --merge
```

No writes. Shows preflight and exact write plan.

## Install

```sh
node platforms/linux/install.mjs --merge
```

The installer prompts for the OpenRouter key unless `ANTHROPIC_AUTH_TOKEN` already exists in `~/.claude/settings.json`.

Scripted:

```sh
read -s OPENROUTER_API_KEY
node platforms/linux/install.mjs --merge --api-key-env OPENROUTER_API_KEY --yes
unset OPENROUTER_API_KEY
```

## What It Writes

- `~/.claude/openrouter-claude-proxy/*`
- `~/.claude/settings.json`
- `~/.local/bin/claude-*`
- `~/.local/bin/or-model`
- `~/.config/systemd/user/openrouter-claude-proxy.service`
- `~/.config/Code/User/settings.json` when VS Code settings path is available

Backups go to:

```text
~/.claude/installer-backups/openrouter-lts-<timestamp>/
```

## Service

```sh
systemctl --user status openrouter-claude-proxy.service
systemctl --user restart openrouter-claude-proxy.service
```

## Verification

```sh
curl http://127.0.0.1:4141/health
claude-router status
node ~/.claude/openrouter-claude-proxy/doctor.mjs
```

## Conservative Uninstall

```sh
node platforms/linux/uninstall.mjs --dry-run
node platforms/linux/uninstall.mjs --apply
```

This only disables the user service. It does not delete settings, proxy files, wrappers, logs, or backups.
