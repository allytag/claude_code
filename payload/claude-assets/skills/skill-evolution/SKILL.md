---
name: Skill Evolution
description: Use when current skills/agents are insufficient, output quality was weak, user says a workflow failed, repeated errors happen, or a new reusable workflow should be added. Drafts improvements safely into skill inbox; never silently installs them.
allowed-tools: Read, Bash, Write
---

# Skill Evolution

Use this skill to improve the LTS system without poisoning future work.

## Safety Model

1. Never modify installed skills directly during drafting.
2. Draft new or updated skill into `~/.claude/skill-inbox/<skill-id>/SKILL.md`.
3. Keep skill narrow: one workflow, clear trigger, minimal allowed tools.
4. Avoid large always-loaded text. Skills should be compact and specific.
5. Do not include secrets, absolute private project paths, or user API keys.
6. Do not include destructive commands, broad deletes, privilege escalation, or hidden network calls.
7. Run guard after drafting:

```sh
node ~/.claude/openrouter-claude-proxy/skill-guard.mjs validate ~/.claude/skill-inbox/<skill-id>
```

8. Promotion requires explicit user approval:

```sh
node ~/.claude/openrouter-claude-proxy/skill-guard.mjs promote ~/.claude/skill-inbox/<skill-id> --apply
```

## Candidate Structure

```text
~/.claude/skill-inbox/<skill-id>/
  SKILL.md
  notes.md        optional evidence: why this skill exists
```

## Good Candidate Criteria

- Clear `name`, `description`, and `allowed-tools`.
- Description tells Claude exactly when to use it.
- Tool list is least-privilege.
- No overlap with an existing skill unless update is intentional.
- Works for many projects, not one private folder.
- Adds quality process, not shortcuts.
