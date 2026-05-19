---
name: Project Memory
description: Use for long-running projects, context compaction, resume/handoff work, multi-session builds, or when the user asks to preserve project state. Creates small verified memory docs only when useful.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Project Memory

Use this skill to preserve useful repo state without bloating prompts.

## Activation

Use when work is multi-step, spans sessions, risks context loss, or the user asks for continuity. Do not use for tiny one-off edits.

## Memory Files

Prefer `docs/agent-memory/`:

- `INDEX.md` — what to read first and current status.
- `PROJECT_CONTEXT.md` — product goal, stack, constraints.
- `ARCHITECTURE.md` — entrypoints, flows, data, integrations.
- `COMMANDS.md` — verified commands only.
- `QA_CHECKLIST.md` — smoke/regression checks.
- `KNOWN_ISSUES.md` — open issues with evidence.
- `DECISIONS.md` — durable decisions and tradeoffs.
- `CURRENT_TASK_STATE.md` — current phase, completed, next safe step.
- `SESSION_HANDOFF.md` — compact handoff for context resets.

## Rules

1. Read existing memory before editing it.
2. Store only verified facts from code, docs, commands, user instructions, or completed work.
3. Keep `AGENTS.md` and `CLAUDE.md` short; put details in `docs/agent-memory/`.
4. Never store secrets, credentials, private tokens, production DB strings, passwords, or sensitive personal data.
5. Do not create memory files for noise. Use only when they prevent real future confusion.
6. Append dated updates or replace stale sections only when clearly superseded.
7. Read before edit, then verify the diff contains only factual memory changes.
8. After substantial work, update `CURRENT_TASK_STATE.md` and `SESSION_HANDOFF.md` if useful.

## Minimal Template

If creating memory, start small:

```text
docs/agent-memory/INDEX.md
docs/agent-memory/PROJECT_CONTEXT.md
docs/agent-memory/COMMANDS.md
docs/agent-memory/CURRENT_TASK_STATE.md
```

Add deeper files only when project complexity justifies them.

## Verification

Before final, report memory files changed and basis for each fact. If no memory update needed, say why in one line.
