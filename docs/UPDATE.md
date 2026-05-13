# Update Guide

Two things can update independently: **the installer repo** and **Claude Code itself**.

## Update This Repo (proxy / wrappers / scripts)

```sh
git pull
./install.sh --dry-run    # preview changes
./install.sh --upgrade    # apply
```

The `--upgrade` flow:
- Backs up everything to `~/.claude/installer-backups/openrouter-lts-<stamp>/`
- Preserves your token in `~/.claude/settings.json`
- Preserves your model role choices in the registry (unless `--reset-registry`)
- Refreshes proxy code, wrappers, doctor, scripts, Skills, subagents, slash commands, statusline, and guarded skill tooling
- Preserves local model registry and agent policy on merge/upgrade

After update:

```sh
./verify.sh
node ~/.claude/openrouter-claude-proxy/doctor.mjs
```

## Update Claude Code CLI + VS Code Extension (snapshot + rollback)

**Always use `claude-safe-update`. Never use raw `claude install`, `claude update`, or manual extension update as the main path.**

```sh
claude-safe-update latest --dry-run    # preview
claude-safe-update latest              # actual update
```

What it does:

```mermaid
flowchart LR
    A[snapshot CLI binary<br/>snapshot VS Code extension] --> B[install CLI version]
    B --> C[install VS Code extension]
    C --> D[patch extension]
    D --> E{validate}
    E -->|all pass| F[keep new version,<br/>write breadcrumb]
    E -->|critical fail| G[restore CLI symlink/snapshot,<br/>restore extension snapshot]
```

Validation checks:
- New binary size ≥ minimum
- Binary executable
- `claude --version` works
- `doctor` reports proxy OK, drift false, no extension mismatch
- Proxy health responds
- Extension patch applies and reports expected status

If anything fails, your old version stays active. You will not be left in a broken state.

If you need CLI-only update for emergency debugging:

```sh
claude-safe-update latest --skip-extension
```

### Optional: post-update model probe

This spends OpenRouter credit to confirm the new CLI version still produces correct request shape:

```sh
claude-safe-update latest --probe --allow-model-call --probe-budget-usd 0.25
```

`--probe` alone does not spend tokens; `--allow-model-call` is explicit consent. `--probe-budget-usd` defaults to `0.25` because Claude Code's full tool contract can exceed tiny local budget caps even for a short prompt.

### Manual rollback

Snapshots live at `~/.claude/binary-snapshots/`. To roll back:

```sh
ls ~/.claude/binary-snapshots/
ln -sfn ~/.claude/binary-snapshots/claude-2.1.131-<hash> ~/.local/bin/claude
claude --version    # confirm
```

Extension snapshots live at `~/.claude/extension-snapshots/`. `claude-safe-update` restores them automatically on critical failure. Manual restore is only for advanced recovery.

## Why Updates Are Frozen

`DISABLE_AUTOUPDATER=1` is set in the LaunchAgent and forwarded by `claude-env.mjs`. This stops Claude CLI from silently downloading updates that could:
- Land mid-session and break tool calls
- Introduce a 400 error from a new beta header that OpenRouter doesn't accept
- Corrupt the binary (the original symptom that motivated `claude-safe-update`)

VS Code extension auto-update and auto-check are disabled in user settings so marketplace update prompts do not interrupt the LTS workflow. The extension's own update command is also hidden by the patcher. This is intentional: update only through `claude-safe-update`.

The `claude-safe-update` command is the **only** sanctioned update path.

## Update VS Code Extension

Preferred path is now `claude-safe-update`, which updates CLI and extension together. The LaunchAgent still re-runs the patcher every 60 s, so any manually installed extension update is auto-patched within a minute:

```sh
node ~/.claude/openrouter-claude-proxy/patch-extension.mjs --dry-run    # check status
```

If a future extension version's minified code breaks the patcher's regex, you'll see `pattern-missed` in `~/.claude/logs/openrouter-claude-proxy.log`. Fix:

1. Open an issue with the new extension version number
2. Update the regex in `payload/openrouter-claude-proxy/patch-extension.mjs`
3. Re-run the installer to deploy

Manual rollback of extension patches:

```sh
node ~/.claude/openrouter-claude-proxy/patch-extension.mjs --rollback
```

## Migration Strategy

When LTS version bumps in `manifest.json`:

| Old → New | Action |
|---|---|
| Patch (e.g. `2026.05.07-1` → `2026.05.07-2`) | `git pull && ./install.sh --upgrade` |
| Minor (e.g. `2026.05.07` → `2026.06.01`) | Read CHANGELOG, then `./install.sh --upgrade` |
| Major (registry schema bump) | Read migration notes, manual review of registry, then `./install.sh --upgrade` |

The breadcrumb at `~/.claude/logs/last-safe-update.json` and the installer backups make every step reversible.
