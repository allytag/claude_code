# Security

What this installer protects, what it does not, and how to verify.

## Threat Model

| Concern | Mitigated by |
|---|---|
| OpenRouter API key leaked into git | `scripts/redact-check.mjs` blocks `sk-or-` and real-token patterns; runs before commit |
| Claude Desktop config tampered | Forbidden-prefix list; installer detects but never writes to `~/Library/Application Support/Claude` |
| Caveman or other user plugins corrupted | `~/.claude/plugins` and `~/plugins/caveman` in cleanup-protected list |
| Hidden reasoning tokens billed silently | Proxy strips `thinking`/`reasoning` by default; pass-through only for registry-allowlisted models on `/effort high` |
| Provider rotation breaks cache → unexpected cost | Provider pinning via registry observed data |
| Auto-update bricks Claude Code | `claude-safe-update` snapshots CLI + VS Code extension, validates, rolls back on failure |
| Settings.json env block ignored by Claude CLI | `claude-env.mjs` re-injects from settings on every wrapper invocation |
| Repo-cloned to a Mac where Claude Code isn't installed | Installer refuses with explicit install instructions |
| User runs install on dirty target | `--fresh` mode refuses; `--merge` preserves unrelated keys |
| Future commit accidentally adds backup/log file | `.gitignore` covers `*-backup*`, `*.jsonl`, `last-metrics.json`, `*.log`, etc. |

## Repo Safety Rules

The repo **must never** contain:

- OpenRouter API key (`sk-or-…`)
- Real `ANTHROPIC_AUTH_TOKEN` value
- Claude Code session transcripts (`*.jsonl`)
- Proxy logs or metrics (`*.log`, `*.jsonl`)
- Any backup file (`*codex-backup*`, `*opus-backup*`)
- Local absolute paths baked into source (`/Users/<name>/...`)
- `.DS_Store`

Verify before every commit:

```sh
node scripts/redact-check.mjs
```

Exit code 0 with `secretLeaks: 0` ⇒ safe to commit.

## API Key Handling

The repo never sees your key. Three flows:

```sh
# 1. Interactive prompt (default, hidden input)
./install.sh --merge

# 2. Non-interactive from env var
read -s OPENROUTER_API_KEY
./install.sh --merge --api-key-env OPENROUTER_API_KEY
unset OPENROUTER_API_KEY

# 3. Already in ~/.claude/settings.json (upgrade case)
./install.sh --upgrade   # reuses existing token, never prompts
```

The token lives at exactly one path:

```text
~/.claude/settings.json   →   env.ANTHROPIC_AUTH_TOKEN
```

Permissions: file-level only, read by `claude-env.mjs` at runtime, never logged, never printed to stdout/stderr.

## Hardened Runtime Boundaries

What the installer **modifies**:

```text
~/.claude/openrouter-claude-proxy/
~/.claude/settings.json                              (merge mode)
~/.local/bin/claude-*                                (wrappers)
~/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist
~/Library/Application Support/Code/User/settings.json   (4 claudeCode.* keys only)
~/.zshrc                                              (appends `claude` function block)
```

What the installer **detects but never modifies**:

```text
~/Library/Application Support/Claude                 Claude Desktop
~/Library/Application Support/Claude/config.json     Claude Desktop config
~/.claude/plugins/                                   user plugins (caveman, etc.)
~/plugins/caveman/                                   caveman source
~/.claude/projects/                                  session transcripts
~/.vscode/extensions/anthropic.claude-code-*/        extension dirs (only patches existing files inside)
```

The cleanup tool's protected list (`scripts/install.mjs` + `modelctl.mjs`) enforces these boundaries even on aggressive cleanup runs.

## Privacy of Metrics

Proxy writes two kinds of metric files:

- `~/.claude/logs/openrouter-claude-proxy-last-metrics.json` — last request only, privacy-safe.
- `~/.claude/logs/openrouter-claude-proxy-metrics.jsonl` — append log, **only** when `DEBUG_TOKENS=1`.

Both contain:
- Token counts, cache counts, cost, latency
- Model IDs, provider names
- Booleans (thinking-removed, cache-applied, etc.)

Both **never** contain:
- Prompts, system content, tool schemas, tool results
- API keys, auth tokens
- File contents

To audit: `cat ~/.claude/logs/openrouter-claude-proxy-last-metrics.json`.

## Update Safety

`claude-safe-update`:
- Snapshots the current Claude Code binary to `~/.claude/binary-snapshots/` before update
- Snapshots installed Claude Code VS Code extensions to `~/.claude/extension-snapshots/` before update
- Validates new binary and extension (size, executable, `--version`, doctor, proxy health, patch status)
- Rolls back CLI symlink/snapshot and extension snapshot on critical validation failure
- Writes a breadcrumb at `~/.claude/logs/last-safe-update.json` for doctor to read
- Optional `--probe --allow-model-call --probe-budget-usd <amount>` runs one OpenRouter call after install (off by default; explicit opt-in)

`DISABLE_AUTOUPDATER=1` is set so Claude CLI does not silently update on its own.

## What to Do If You Suspect a Leak

If a key was committed:

1. `git log -p | grep -i "sk-or-"` to confirm
2. Rotate the key on [openrouter.ai/keys](https://openrouter.ai/keys) immediately
3. `git filter-repo --replace-text expressions.txt` to scrub history
4. Force-push (only if you control the remote)
5. Re-run `node scripts/redact-check.mjs` until clean

The redaction check is also useful as a pre-commit hook:

```sh
echo 'node scripts/redact-check.mjs || exit 1' >> .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```
