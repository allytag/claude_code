---
name: Context Intelligence
description: Use when work may touch a codebase, long session, large files, unknown repo structure, or model context is limited. Finds relevant context first, avoids broad dumps, keeps a compact working map, and recommends compact/fresh-session points.
allowed-tools: Read, Bash
---

# Context Intelligence

Use this skill before large implementation, debugging, refactors, or unfamiliar repos.

## Context Budget Rules

1. Start with intent, not repo scan. Identify target feature, error, route, component, API, or user flow.
2. If `AGENTS.md`, `CLAUDE.md`, or `docs/agent-memory/INDEX.md` exists, read only the relevant boot/memory files first, then verify claims against code.
3. Use `Bash` with `rg`, `rg --files`, or `find` to find candidate files. Read only likely relevant files.
4. Prefer file maps and symbol names over full file contents until edit scope is clear.
5. Keep a short context ledger in the response: goal, relevant files, assumptions, decisions, next edit scope.
6. If session history grows or repeated full tool context appears, recommend `/compact` with a concrete focus.
7. For unrelated tasks, recommend fresh session instead of carrying stale history.

## Search Pattern

- Find entrypoints: routes, pages, controllers, handlers, package scripts.
- Find data model: schema, types, validators, API contracts.
- Find UI components: parent page, reusable components, styles, state.
- Find tests: nearest unit/e2e/integration coverage.
- Find config only when needed: build, lint, test, env, framework.

## Output Standard

Return concise context map:

- `Goal`
- `Likely Files`
- `Risk`
- `Plan`
- `Need Read Next`

Do not read huge logs or generated files unless user asks. Summarize long outputs.
