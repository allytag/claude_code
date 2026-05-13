---
description: Build a compact implementation plan with relevant context only.
argument-hint: [task]
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(find:*), Bash(rg:*)
---

# Smart Plan

Task: $ARGUMENTS

Use Context Intelligence. Do not scan whole repo blindly.

Return:

1. Goal
2. Relevant files to inspect or edit
3. Architecture risks
4. Step-by-step plan
5. Tests/verification
6. Compact/fresh-session advice if context is already large
