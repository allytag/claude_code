---
description: Find relevant files and repo map before implementation.
argument-hint: [feature/error/component]
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(find:*), Bash(rg:*)
---

# Context Scout

Target: $ARGUMENTS

Find only relevant context. Prefer `rg`/`Glob`. Do not edit files.

Return:

- Entry points
- Related components/routes/services
- Data/types/schema
- Tests
- Unknowns
- Minimal next reads
