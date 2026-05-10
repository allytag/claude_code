# Install Guide

Step-by-step installation, verification, and daily workflow.

## Prerequisites

| | Check | Install if missing |
|---|---|---|
| **macOS** | `uname -m` returns `arm64` | Apple Silicon required |
| **Node.js ≥ 20** | `node --version` | `brew install node` |
| **Zsh** | `echo $SHELL` returns `…/zsh` | macOS default since Catalina |
| **Claude Code CLI** | `claude --version` | `curl -fsSL https://claude.ai/install.sh \| bash` |
| **OpenRouter key** | n/a | [openrouter.ai/keys](https://openrouter.ai/keys) |

Optional: VS Code + `anthropic.claude-code` extension. The installer detects both and skips that step if missing.

## Steps

### 1. Install official Claude Code (if not already)

```sh
curl -fsSL https://claude.ai/install.sh | bash
type -a claude
claude --version
```

Or via npm:

```sh
npm install -g @anthropic-ai/claude-code
```

### 2. Clone this repo

```sh
git clone <your-repo-url> Claude
cd Claude
```

### 3. Preview the install (always)

```sh
./install.sh --dry-run
```

This prints:
- a compatibility report (OS, Node, Claude CLI, VS Code, existing setup)
- the exact write plan (every backup, file copy, symlink, merge)

No files are touched.

### 4. Run the install

Default safe mode (preserves any existing settings):

```sh
./install.sh --merge
```

You will be prompted for your OpenRouter API key. Input is hidden in your terminal and written only to `~/.claude/settings.json` on this Mac.

Non-interactive (CI / scripted):

```sh
read -s OPENROUTER_API_KEY
./install.sh --merge --api-key-env OPENROUTER_API_KEY --yes
unset OPENROUTER_API_KEY
```

Fresh-only mode (refuses if `~/.claude` already has a setup):

```sh
./install.sh --fresh
```

### 5. Verify

```sh
./verify.sh
```

Or manually:

```sh
curl -sS http://127.0.0.1:4141/health
node ~/.claude/openrouter-claude-proxy/doctor.mjs
claude-router status
```

Open a new terminal (or `source ~/.zshrc`), then:

```sh
claude --version
```

## Daily Workflow

### Coding

```sh
claude                                          # full Claude Code, your main model
claude-kimi -p "refactor this function"         # one-off Kimi without changing main
claude-deepseek -p "hard architecture review"   # one-off DeepSeek (reasoning passes through on /effort high)
```

### Quick chat (no tools, cheapest)

```sh
claude-low "explain debounce in 5 bullets"
claude-low --model qwen "summarize this paragraph"
```

### Watch tokens / cost in real time

In a separate terminal:

```sh
claude-router tail
```

Each request logs model, provider, input/output tokens, cache_read, cost, latency.

### Inspect and switch models

```sh
claude-router status                  # everything in one view
claude-router list                    # all registry models
claude-router resolve main            # what does 'main' point to right now?

claude-router use main kimi-k2.6      # change main role
claude-router apply-settings          # write to ~/.claude/settings.json
```

### Add a new OpenRouter model

```sh
claude-router add grok x-ai/grok-4 --name "Grok 4"
claude-model grok -p "test it"
claude-router use compare grok        # assign to compare role
```

### Cleanup stale data

```sh
claude-router cleanup all-safe        # dry-run preview
claude-router cleanup all-safe --apply
```

Categories: `trash`, `logs`, `metrics`, `sessions`, `shell-snapshots`, `old-backups`, `empty-dirs`, `file-history`, `extension-snapshots`, `telemetry`, `benchmarks`. Always dry-run first.

### Update Claude Code (always use safe-update)

```sh
claude-safe-update latest --dry-run
claude-safe-update latest
claude-safe-update latest --probe --allow-model-call --probe-budget-usd 0.25
```

See [UPDATE.md](UPDATE.md).

## Modes Reference

| Flag | Behavior |
|---|---|
| `--dry-run` | Print preflight + plan, write nothing |
| `--merge` | Default. Preserves existing keys. Prompts for token only if missing. |
| `--fresh` | Refuse install if `~/.claude` is non-empty |
| `--upgrade` | Same as merge, but logs intent as upgrade |
| `--yes` | Skip confirmation prompts (still requires `--api-key-env` if no token already on disk) |
| `--api-key-env NAME` | Read OpenRouter key from env var instead of prompting |

## After Install

The installer leaves these in place:

```text
~/.claude/openrouter-claude-proxy/         proxy + registry + scripts
~/.claude/settings.json                    your env (token here)
~/.claude/installer-backups/<stamp>/       full pre-install backup
~/.local/bin/claude-*                      wrappers
~/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist
~/Library/Application Support/Code/User/settings.json   (4 claudeCode.* keys)
~/.zshrc                                    appended `claude` function
```

To roll back any future change, every install/update keeps a timestamped backup:

```sh
./uninstall.sh --restore-last-backup
```
