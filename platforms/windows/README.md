# Windows Support

Status: **Beta**.

Windows support is isolated under `platforms/windows` and does not change the macOS LTS installer.

## Requirements

- Windows 10/11
- Node.js >= 20
- Official Claude Code CLI already installed
- `%USERPROFILE%\.local\bin` in `PATH`
- VS Code optional
- Task Scheduler optional

## Dry Run

```powershell
node platforms/windows/install.mjs --dry-run --merge
```

No writes. Shows preflight and exact write plan.

## Install

```powershell
node platforms/windows/install.mjs --merge
```

Scripted:

```powershell
$secret = Read-Host "OpenRouter API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  node platforms/windows/install.mjs --merge --api-key-env OPENROUTER_API_KEY --yes
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:\OPENROUTER_API_KEY -ErrorAction SilentlyContinue
}
```

If you do not use `--api-key-env`, the installer prompts for the OpenRouter key.

## Optional Task Scheduler Startup

Default Windows install writes a manual starter:

```text
%USERPROFILE%\.local\bin\start-openrouter-claude-proxy.cmd
```

To create a logon task:

```powershell
node platforms/windows/install.mjs --merge --enable-task
```

## Updates

Use the official Claude Code update path on Windows, then rerun:

```powershell
node platforms/windows/install.mjs --dry-run --merge
node platforms/windows/install.mjs --merge
```

`claude-safe-update` is currently macOS/Linux-oriented and is not installed on Windows.

## What It Writes

- `%USERPROFILE%\.claude\openrouter-claude-proxy\*`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.local\bin\*.cmd`
- `%APPDATA%\Code\User\settings.json`
- Optional Task Scheduler XML under `%USERPROFILE%\.claude\openrouter-claude-proxy\`

Backups go to:

```text
%USERPROFILE%\.claude\installer-backups\openrouter-lts-<timestamp>\
```

## Verification

```powershell
curl http://127.0.0.1:4141/health
claude-router.cmd status
node $env:USERPROFILE\.claude\openrouter-claude-proxy\doctor.mjs
```

## Conservative Uninstall

```powershell
node platforms/windows/uninstall.mjs --dry-run
node platforms/windows/uninstall.mjs --apply
```

This only deletes the optional Task Scheduler task. It does not delete settings, proxy files, wrappers, logs, or backups.
