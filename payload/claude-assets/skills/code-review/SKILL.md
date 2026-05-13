---
name: Code Review
description: Senior code review workflow. Use when reviewing changes, checking quality before commit, evaluating generated code, or finding bugs/security risks.
allowed-tools: Read, Grep, Glob, Bash
---

# Code Review

Use this skill for rigorous review.

## Review Priority

1. Correctness bugs and regressions.
2. Security, auth, secrets, permissions, injection, data leaks.
3. Data consistency, migrations, transactions, concurrency.
4. Error handling and edge cases.
5. Performance and scalability.
6. Test coverage gaps.
7. Maintainability and readability.

## Output

Findings first, ordered by severity, with file and line references when available. If no findings, say so and list residual risks or tests not run.
