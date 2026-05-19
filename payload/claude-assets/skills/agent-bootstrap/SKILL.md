---
name: Agent Bootstrap
description: Use when setting up or repairing repo agent instructions for Claude Code, Codex, or both. Proposes durable AGENTS.md, CLAUDE.md, and project memory changes before writing unless setup was explicitly requested.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Agent Bootstrap

Use this skill to add durable project instructions without overwriting repo intent.

## When To Use

- User asks to bootstrap Claude Code, Codex, or AI agent workflow.
- Repo lacks useful `AGENTS.md` / `CLAUDE.md` and the user wants setup or repair.
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
7. If boot files or `docs/agent-memory/` are missing, do not auto-create them. Propose the files, summarize each in one line, and wait for explicit approval.
8. Exception: create directly only when the user explicitly asked for project setup, agent setup, memory setup, or said to set up the repo.

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
3. Patch existing boot files when requested or clearly part of the task.
4. If files are missing, propose creating compact boot files and minimal memory index unless setup was explicitly requested.
5. Run diff review. Confirm no secrets or huge prompt dumps.

## Output

Report files created/changed, preserved existing rules, and any assumptions not verified.
