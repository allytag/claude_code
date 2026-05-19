---
name: Project Memory
description: Use for long-running projects, context compaction, resume/handoff work, multi-session builds, or when the user asks to preserve project state. Proposes small verified memory docs before creating them unless setup was explicitly requested.
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
8. If boot files or `docs/agent-memory/` are missing, do not auto-create them. Propose the files, summarize each in one line, and wait for explicit approval.
9. Exception: create directly only when the user explicitly asked for project setup, agent setup, memory setup, or said to set up the repo.
10. After substantial work, update `CURRENT_TASK_STATE.md` and `SESSION_HANDOFF.md` only when memory files already exist or the user approved them for this repo.

## What NOT To Store

- Bad: pasted `.env` content. Safe: reference `.env.example` keys without values.
- Bad: real database connection strings. Safe: use `DATABASE_URL=<set locally>` or vault reference.
- Bad: JWTs or decoded claims from real users. Safe: synthetic token shape and claim names only.
- Bad: OAuth client secrets or webhook signing secrets. Safe: provider name plus "stored in secrets manager".
- Bad: private wallet keys, seed phrases, or deployer keys. Safe: public address only when needed.
- Bad: AWS/GCP/cloud access keys. Safe: IAM role name or setup doc path.

## Minimal Template

If approved to create memory, start small:

```text
docs/agent-memory/INDEX.md
docs/agent-memory/PROJECT_CONTEXT.md
docs/agent-memory/COMMANDS.md
docs/agent-memory/CURRENT_TASK_STATE.md
```

Add deeper files only when project complexity justifies them.

## Verification

Before final, report memory files changed and basis for each fact. If no memory update needed, say why in one line.
