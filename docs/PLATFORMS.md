# Platform Support

## Status Matrix

| Platform | Status | Installer | Startup |
|---|---|---|---|
| macOS Apple Silicon | LTS | `./install.sh` | LaunchAgent |
| Linux | Beta | `node platforms/linux/install.mjs` | `systemd --user` |
| Windows | Beta | `node platforms/windows/install.mjs` | Manual `.cmd` or optional Task Scheduler |

## Policy

- macOS LTS flow remains the stable default.
- Linux and Windows live in isolated `platforms/<os>` folders.
- Linux/Windows installers reuse the same proxy payload and model registry, but they do not change macOS installer behavior.
- No platform installer stores API keys in the repo.
- No platform installer runs model calls.
- Dry-run mode is available on every platform.

## Linux

```sh
node platforms/linux/install.mjs --dry-run --merge
node platforms/linux/install.mjs --merge
```

Writes:

- `~/.claude/openrouter-claude-proxy`
- `~/.claude/settings.json`
- `~/.local/bin/claude-*`
- `~/.config/systemd/user/openrouter-claude-proxy.service`
- `~/.config/Code/User/settings.json`

## Windows

```powershell
node platforms/windows/install.mjs --dry-run --merge
node platforms/windows/install.mjs --merge
```

Optional Task Scheduler startup:

```powershell
node platforms/windows/install.mjs --merge --enable-task
```

Writes:

- `%USERPROFILE%\.claude\openrouter-claude-proxy`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.local\bin\*.cmd`
- `%APPDATA%\Code\User\settings.json`
- Optional Task Scheduler task `OpenRouterClaudeProxy`

## Validation Checklist

Use this checklist when validating a new platform install:

1. Fresh install dry-run.
2. Real install with OpenRouter key.
3. Proxy health.
4. `claude-router status`.
5. Claude Code CLI full-mode smoke prompt.
6. VS Code extension session.
7. Safe cleanup dry-run.
8. Reboot persistence.

Linux and Windows support is marked **Beta** while the macOS installer remains the primary LTS path.
