---
description: Draft or validate a new reusable skill safely in the skill inbox.
argument-hint: [workflow gap / failed behavior / desired skill]
allowed-tools: Read, Grep, Glob, Bash, Write
---

# Skill Forge

Gap: $ARGUMENTS

Use Skill Evolution and Tool Coach.

Workflow:

1. Identify reusable gap and evidence.
2. Check existing skills first:
   ```sh
   ls ~/.claude/skills
   ```
3. Draft candidate only in:
   ```text
   ~/.claude/skill-inbox/<skill-id>/SKILL.md
   ```
4. Use narrow allowed tools.
5. Run guard:
   ```sh
   node ~/.claude/openrouter-claude-proxy/skill-guard.mjs validate ~/.claude/skill-inbox/<skill-id>
   ```
6. Report guard result and promotion command.

Do not promote without explicit user approval.
