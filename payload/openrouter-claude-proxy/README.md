# OpenRouter Claude Code Proxy

Stable local runtime for original Claude Code CLI and Claude Code VS Code extension.

## Architecture

```text
Full Claude Code mode:
claude / VS Code extension
-> http://127.0.0.1:4141
-> https://openrouter.ai/api
-> OpenRouter custom model

Low-token mode:
claude-low
-> http://127.0.0.1:4141
-> https://openrouter.ai/api
-> qwen/qwen3.6-plus by default
```

## Purpose

- Route original Claude Code to OpenRouter's Anthropic-compatible endpoint.
- Keep OpenRouter key in `__HOME__/.claude/settings.json`.
- Strip `thinking` / `redacted_thinking` blocks from stream and JSON responses.
- Remove thinking/reasoning request fields before upstream call.
- Re-patch Claude Code VS Code extension after updates.
- Write privacy-safe `last-metrics.json` for real `/v1/messages` requests.
- Append JSONL metrics only when debug logging is enabled.
- Provide separate low-token wrapper for simple Q&A without Claude Code tool contract.
- Remap only verified tiny internal Claude Code Haiku background calls to the registry `cheapFull` role.
- Record finish reasons, retry count, context advice, provider, tokens, and cost.
- Retry transient provider/network failures once by default.
- Report installed Skills, agents, slash commands, and statusline through doctor.
- Guard skill drafts through `skill-guard.mjs` before optional promotion.

## Commands

Health:

```sh
curl -sS http://127.0.0.1:4141/health
```

Doctor:

```sh
node __HOME__/.claude/openrouter-claude-proxy/doctor.mjs
```

Manual extension patch:

```sh
node __HOME__/.claude/openrouter-claude-proxy/patch-extension.mjs
```

Rollback extension patch:

```sh
node __HOME__/.claude/openrouter-claude-proxy/patch-extension.mjs --rollback
```

Safe Claude CLI update:

```sh
claude-safe-update latest --dry-run
claude-safe-update latest
claude-safe-update latest --probe --allow-model-call --probe-budget-usd 0.25
```

`claude-safe-update` snapshots the current working binary and Claude Code VS Code extension, quarantines zero-byte failed downloads, runs official `claude install <target>` and `code --install-extension` only after preflight passes, applies extension patches, validates proxy/doctor/patch status, and restores CLI + extension snapshots on critical failure. It writes `__HOME__/.claude/logs/last-safe-update.json` only after an accepted update. No model call runs unless explicitly invoked with `--probe --allow-model-call`.

Low-token mode:

```sh
claude-low "explain debounce in 5 bullets"
claude-low --model qwen "hello"
claude-low --model kimi "summarize this pasted text"
```

Full/model wrappers:

```sh
claude-full
claude-kimi
claude-qwen
claude-deepseek
```

`claude-full`, `claude-model`, and `claude-role` run the original Claude binary through `claude-env.mjs`, which injects `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_API_KEY=""` from `__HOME__/.claude/settings.json` without printing the token.
`DISABLE_AUTOUPDATER=1` is also forwarded so surprise auto-update paths stay off. `DISABLE_UPDATES=1` is intentionally not set because it can block manual safe updates.

VS Code extension update checks are disabled by installer settings, and `patch-extension.mjs` hides the Claude Code extension update command. Manual update path remains `claude-safe-update`.

Claude router/controller:

```sh
claude-router list
claude-router status
claude-router help workflow
claude-router tail                                # live-watch last-metrics.json updates
claude-router add deepseek-v5 deepseek/deepseek-v5
claude-router add hy3-preview-free tencent/hy3-preview:free --name "Tencent HY3 Preview Free" --as main --apply
claude-router use main kimi-k2.6
claude-router remove hy3-preview-free --replace-with kimi-k2.6
claude-router apply-settings --dry-run
claude-router benchmark plan --models deepseek-v4-pro,kimi-k2.6,qwen3.6-plus
claude-router cache-test plan --models main,cheapFull   # 2-turn cache check plan
claude-model kimi-k2.6 -p "say hi"
claude-role main -p "say hi"
```

`or-model` remains a backward-compatible alias for `claude-router`.

Skill guard:

```sh
node __HOME__/.claude/openrouter-claude-proxy/skill-guard.mjs status
node __HOME__/.claude/openrouter-claude-proxy/skill-guard.mjs validate __HOME__/.claude/skill-inbox/<skill-id>
node __HOME__/.claude/openrouter-claude-proxy/skill-guard.mjs promote __HOME__/.claude/skill-inbox/<skill-id> --apply
```

Promotion backs up the old skill and writes only the target skill directory. No skill is installed automatically.

Cleanup (always dry-run unless `--apply`):

```sh
claude-router cleanup                                  # default safe categories (trash, old-backups>30d, empty-dirs, extension-snapshots, benchmarks)
claude-router cleanup all-safe                         # all safe categories with their default ages
claude-router cleanup sessions --older-than 14d        # ~/.claude/projects/*/<uuid>.jsonl older than 14 days
claude-router cleanup backups --older-than 0d          # alias for old-backups; keeps most recent per source file
claude-router cleanup old-backups --older-than 0d      # same as backups
claude-router cleanup shell-snapshots --older-than 7d
claude-router cleanup extension-snapshots --older-than 14d
claude-router cleanup trash                            # .opus-trash-* files
claude-router cleanup empty-dirs                       # leftover empty UUID dirs in file-history/session-env
claude-router cleanup all-safe --apply                 # actually delete after reviewing dry-run
```

Hard-protected (never listed/deleted): `settings.json`, all `settings.json.*` backups, `model-registry.json`, current proxy code/docs, current logs/metrics, the LaunchAgent plist, the entire `~/.claude/plugins` tree (caveman included), Claude Desktop dirs, all VS Code extension folders. The most recent backup per source file is always kept as a rollback safety net.

Registry:

```text
__HOME__/.claude/openrouter-claude-proxy/model-registry.json
```

Rules:

- Catalog/listed pricing and observed/effective pricing are separate fields.
- `claude-router pricing refresh` can update catalog pricing from OpenRouter, but needs network approval.
- `claude-router apply-settings` writes Claude Code slot settings from registry roles and creates a backup.
- `claude-router use <role> <alias>` switches role and applies Claude settings in one safe command.
- `claude-router remove <alias> --replace-with <alias>` prevents empty roles when deleting stale models.
- `claude-model` tests any alias or raw OpenRouter model ID without changing defaults.
- `claude-role lowToken` uses explicit `claude-low`; other roles use full Claude Code.

## Environment Flags

Metrics:

Every real `/v1/messages` request writes the latest privacy-safe summary:

```text
__HOME__/.claude/logs/openrouter-claude-proxy-last-metrics.json
```

Optional JSONL debug metrics:

```sh
launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy
```

`OPENROUTER_PROXY_DEBUG_TOKENS=1` is persisted in the LaunchAgent. Metrics remain privacy-safe: no prompts, file contents, full tool schemas, or API keys.

When enabled, appends:

```text
__HOME__/.claude/logs/openrouter-claude-proxy-metrics.jsonl
```

Budget guard:

```sh
launchctl setenv OPENROUTER_PROXY_BUDGET_STRICT 1
launchctl setenv OPENROUTER_PROXY_WARN_CONTEXT_TOKENS 50000
launchctl setenv OPENROUTER_PROXY_WARN_COST_USD 0.02
launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy
```

Prompt/response caching:

```sh
# Anthropic-format cache_control on last system block + last user content block.
# Off (default), or "anthropic" (legacy: only anthropic/* model IDs), or "auto" (any model).
launchctl setenv OPENROUTER_PROXY_RESPONSE_CACHE 1
launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy
```

Modes:

- `off` (default): proxy does not modify cache_control fields.
- `anthropic` (legacy `1`/`true`/`on`): inject ephemeral cache_control only for `anthropic/*` models.
- `auto`: for any model, attach cache_control on the last system block and the last user content block, unless Claude Code already attached cache_control inline.

Notes:

- Anthropic-format prompt caching uses `cache_control: {type: "ephemeral"}` markers on content blocks, not a top-level field. The previous "top-level" approach did not actually enable caching for any provider.
- `OPENROUTER_PROXY_PROMPT_CACHE=auto` is persisted in the LaunchAgent.
- `auto` mode is safe for any model: providers that don't honor cache_control simply ignore it. Providers that do honor it (Anthropic models, Moonshot/Kimi via Anthropic-format) will report `cache_read_input_tokens` on subsequent same-session turns.
- Local single-turn Kimi tests showed `cache_read=0`. Multi-turn same-session tests with `OPENROUTER_PROXY_PROMPT_CACHE=auto` are required to confirm whether prompt cache works for each model. Use `claude-router cache-test plan` to see the planned commands.
- `OPENROUTER_PROXY_RESPONSE_CACHE=1` only applies to low-token requests with no tools.

Provider pinning:

```sh
# When a model has an observed.latestProvider in the registry, force OpenRouter to use that provider.
# Strongly recommended for cache continuity (cache breaks if OpenRouter rotates providers).
launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy
```

- Persisted in the LaunchAgent as `OPENROUTER_PROXY_PIN_PROVIDER=1`. The proxy never overrides a client-supplied `provider` field.
- Lookup is by registry alias; if a model's `observed.latestProvider` is null, no pin is added.
- Run `claude-router status` to see which models can currently be pinned.

Internal Haiku background remap:

```text
claude-haiku-* / claude-*-haiku* / anthropic/claude-haiku-* / anthropic/claude-*-haiku*
-> registry role cheapFull
-> currently qwen/qwen3.6-plus
```

- Persisted in the LaunchAgent as `OPENROUTER_PROXY_REMAP_INTERNAL_HAIKU=1`.
- Config lives in `model-registry.json` under `remaps.internalHaiku`.
- Safety gates: Claude CLI source, max 2 messages, max 2000 system chars, no tools, tiny request body.
- Full Claude Code requests with tools, project context, bash, edits, or large tool schema are not remapped.
- Doctor/status warns if a Haiku-like model appears without remap.

Reasoning policy:

- Proxy strips `thinking`/`reasoning` fields by default.
- `/effort high` is honored only when the selected registry model has `compatibility.reasoningPassThrough=true`.
- Current allowlist: `deepseek-v4-pro`.
- Kimi/Qwen/HY3/GLM stay stripped even if global `effortLevel` is high, preventing surprise reasoning-token burn.

Telemetry and cleanup:

- `DISABLE_TELEMETRY=1` is set for Claude Code path, not Claude Desktop.
- Cleanup categories include `file-history`, `extension-snapshots`, and `telemetry`.
- `file-history` cleanup deletes only whole old UUID dirs, keeps newest dir, never partial files.
- `extension-snapshots` cleanup deletes only whole old safe-update snapshot dirs, keeps newest snapshot.
- `telemetry` cleanup deletes only `telemetry/1p_failed_events*.json`.

```sh
claude-router cleanup all-safe
claude-router cleanup file-history --older-than 30d --apply
claude-router cleanup extension-snapshots --older-than 14d --apply
claude-router cleanup telemetry --older-than 14d --apply
```

Prompt caching 1h:

- `ENABLE_PROMPT_CACHING_1H=1` exists in Claude Code but is not enabled by default.
- Enable only after controlled cache test, because some OpenRouter providers can reject new beta/cache shapes.
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is documented as emergency escape hatch only, not default.

Low-token mode is explicit only. Use `claude-low`. Full Claude Code requests are never silently rewritten to low-token mode.

## Full Setup Summary

```text
__HOME__/.claude/openrouter-claude-proxy/README.md
__HOME__/.claude/openrouter-claude-proxy/model-registry.json
__HOME__/.claude/openrouter-claude-proxy/doctor.mjs
```
