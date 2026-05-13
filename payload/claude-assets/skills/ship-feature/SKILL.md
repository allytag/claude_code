---
name: Ship Feature
description: End-to-end feature delivery workflow. Use when implementing production features, building SaaS modules, refactoring flows, or turning a request into working tested code.
allowed-tools: Read, Grep, Glob, Bash, Edit, MultiEdit, Write
---

# Ship Feature

Use this skill for production-grade implementation.

## Workflow

1. Clarify outcome and constraints from existing code, not assumptions.
2. Inspect architecture, routes, data model, state flow, tests, and conventions.
3. Plan small slices: data, API, UI, validation, error handling, tests.
4. Implement incrementally. Keep diffs focused.
5. Run the smallest meaningful validation first, then broader tests.
6. Review for regressions, security, performance, accessibility, and maintainability.
7. Summarize what changed, what was verified, and remaining risk.

## Standards

- Preserve existing design system and conventions.
- Avoid overengineering. Add abstraction only when reuse is real.
- Do not silently weaken validation, auth, permission, billing, or data integrity.
- Prefer explicit failure handling over optimistic success paths.
- Keep user-facing copy clean and product-grade.
