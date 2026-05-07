# Troubleshooting

Problem → fix pairs. Run `./verify.sh` first; it catches most issues.

## Diagnosis

### `./verify.sh` fails

Run it with full output and read the first failed check.

```sh
./verify.sh
```

Common follow-ups:
- `node scripts/redact-check.mjs` — secrets check
- `node scripts/doctor-local.mjs` — repo file integrity
- `node ~/.claude/openrouter-claude-proxy/doctor.mjs` — runtime state on this Mac

---

## Install Issues

### Claude CLI missing

```sh
curl -fsSL https://claude.ai/install.sh | bash
type -a claude && claude --version
```

Then re-run `./install.sh --dry-run`.

### Node missing or version too low

```sh
brew install node
node --version
```

Need `>= 20`.

### `claude` command not found after install

The `claude` zsh function is in `~/.zshrc` — open a new terminal, or:

```sh
source ~/.zshrc
type claude    # should print: claude is a shell function
```

If `~/.local/bin` isn't in PATH:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### VS Code extension missing or unpatched

```sh
code --install-extension anthropic.claude-code
node ~/.claude/openrouter-claude-proxy/patch-extension.mjs --dry-run
node ~/.claude/openrouter-claude-proxy/patch-extension.mjs
```

The LaunchAgent re-patches every 60 s, so a manual run is rarely needed.

### Installer refuses with "Original Claude Code CLI missing"

Install Claude Code first (above). The installer will not proceed without it.

### `--fresh` refuses on a Mac that has Claude Desktop

`--fresh` requires `~/.claude` to be empty. If you've used Claude Desktop or Claude Code before, use `--merge` instead.

---

## Runtime Issues

### Proxy down / no `127.0.0.1:4141` response

```sh
launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy
sleep 2
curl -sS http://127.0.0.1:4141/health
```

Logs:

```sh
tail -100 ~/.claude/logs/openrouter-claude-proxy.log
tail -100 ~/.claude/logs/openrouter-claude-proxy.err.log
```

### Authentication failures (401 from OpenRouter)

Verify token is in settings:

```sh
node -e 'console.log(JSON.parse(require("fs").readFileSync(`${process.env.HOME}/.claude/settings.json`,"utf8")).env.ANTHROPIC_AUTH_TOKEN ? "present" : "MISSING")'
```

If missing, re-run `./install.sh --merge` and re-enter the key.

### "Not logged in" from terminal `claude`

Claude CLI 2.1.131+ ignores `~/.claude/settings.json`'s env block. The `claude-env.mjs` wrapper handles this. Make sure you're using the wrapper:

```sh
type claude    # should be a shell function calling claude-full
```

If not, your shell didn't reload `.zshrc`. Open a new terminal.

### Drift between settings and registry

```sh
claude-router status
node ~/.claude/openrouter-claude-proxy/doctor.mjs   # look for drift block
```

Fix:

```sh
claude-router apply-settings --dry-run
claude-router apply-settings
```

### Stale model in registry (e.g., model deprecated by provider)

```sh
claude-router remove <stale-alias> --replace-with <good-alias>
claude-router apply-settings
```

---

## Update Issues

### `claude-safe-update` fails preflight

Read the preflight section of the JSON output. Common blockers:
- Disk free below threshold
- Network preflight to `downloads.claude.ai` failed
- Zero-byte file from prior failed update — quarantined automatically

After fixing, re-run `claude-safe-update latest --dry-run`.

### `claude-safe-update` succeeds but `claude --version` is wrong

```sh
ls -la ~/.local/bin/claude    # check symlink target
ls ~/.claude/binary-snapshots/  # snapshots from previous runs
```

To roll back manually:

```sh
ln -sfn ~/.claude/binary-snapshots/claude-<version>-<hash> ~/.local/bin/claude
```

### Auto-updater ran anyway

```sh
plutil -convert json -o - ~/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist | grep -i autoupdater
```

Should show `DISABLE_AUTOUPDATER: "1"`. If not, re-run `./install.sh --upgrade`.

---

## Cache / Cost Issues

### High cost on every turn (no cache hits)

```sh
claude-router tail
```

Check `cache_read` column. If always 0:
1. Verify `OPENROUTER_PROXY_PROMPT_CACHE=auto` in plist:
   ```sh
   plutil -convert json -o - ~/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist
   ```
2. Verify provider pinning is on (`OPENROUTER_PROXY_PIN_PROVIDER=1`).
3. Verify the model has `cacheBehavior: "cache-read-observed"` in registry.
4. Ensure same-session turns within Anthropic's 5-min cache TTL.

### Cache works on turn 2 but not turn 3

Provider may have rotated. Confirm pinning:

```sh
node ~/.claude/openrouter-claude-proxy/doctor.mjs | jq '.cacheReadiness'
```

---

## Cleanup Issues

### `claude-router cleanup` shows nothing to delete

Default categories are conservative (e.g., backups must be 30 days old). Override:

```sh
claude-router cleanup old-backups --older-than 0d         # dry-run
claude-router cleanup all-safe --older-than 0d --apply    # apply
```

### Cleanup deleted something I needed

The cleanup tool keeps the **most recent** backup per source file as a rollback safety net. If you deleted older ones, restore from `~/.claude/installer-backups/<stamp>/`.

---

## Reset Everything

If state gets too tangled:

```sh
./uninstall.sh --restore-last-backup    # rolls back to pre-install state
```

Then a clean install:

```sh
./install.sh --dry-run
./install.sh --merge
```

Claude Code itself, Claude Desktop, caveman, your projects: all untouched by uninstall.

---

## Reporting Issues

When opening a GitHub issue, include:

```sh
# Sanitized state snapshot — paste output of all of these
sw_vers
node --version
claude --version
node ~/.claude/openrouter-claude-proxy/doctor.mjs
./verify.sh
```

Do not paste your API key. Doctor output is privacy-safe by design.
