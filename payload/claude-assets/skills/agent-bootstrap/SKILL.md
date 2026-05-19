---
name: Agent Bootstrap
description: Use when setting up or repairing repo agent instructions for Claude Code, Codex, or both. Safely creates or updates AGENTS.md, CLAUDE.md, and project memory only when asked or clearly missing/weak.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Agent Bootstrap

Use this skill to add durable project instructions without overwriting repo intent.

## When To Use

- User asks to bootstrap Claude Code, Codex, or AI agent workflow.
- Repo lacks useful `AGENTS.md` / `CLAUDE.md`.
- Existing instructions are stale, duplicated, unsafe, or too large.
- Long project needs small boot files plus memory docs.

Do not use for normal coding unless instructions are part of the task.

## Safety Rules

1. Read existing `AGENTS.md`, `CLAUDE.md`, README, package scripts, and relevant docs first.
2. Never overwrite existing instructions blindly.
3. Preserve project-specific rules; append guarded updates when possible.
4. Keep boot files short: commands, safety rules, memory location, verification expectations.
5. Put detailed context in `docs/agent-memory/`, not in boot files.
6. Do not add secrets, credentials, private paths, or one-project assumptions to reusable skills.
7. If unsure whether persistent files are wanted, propose plan or draft first.

## Boot File Shape

Include only:

- project identity and critical flows
- verified setup/test/build commands
- destructive-action and secret rules
- where memory docs live
- when to update memory
- final verification expectations

## Workflow

1. Detect target: Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`), or both.
2. Inspect existing files and commands.
3. Create compact boot file or patch existing one.
4. Optionally create minimal `docs/agent-memory/INDEX.md`.
5. Run diff review. Confirm no secrets or huge prompt dumps.

## Output

Report files created/changed, preserved existing rules, and any assumptions not verified.
