---
description: Choose best Claude Code tools and verification path before work.
argument-hint: [task]
allowed-tools: Read, Grep, Glob, Bash
---

# Tool Coach

Task: $ARGUMENTS

Use Tool Coach.

Return:

- Best tool sequence
- Files/searches to start with
- Verification command
- Long-command handling if needed
- Stop condition if tools fail

Do not edit files.
