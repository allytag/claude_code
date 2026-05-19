---
name: Ship Feature
description: End-to-end feature delivery workflow. Use when implementing production features, building SaaS modules, refactoring flows, or turning a request into working tested code.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Ship Feature

Use this skill for production-grade implementation.

## Workflow

1. Clarify outcome and constraints from existing code, not assumptions.
2. Translate request into the user journey and production flow that must work.
3. Inspect architecture, routes, data model, state flow, tests, and conventions.
4. Plan small slices: data, API, UI, validation, error handling, tests.
5. Implement incrementally. Keep diffs focused.
6. Run the smallest meaningful validation first, then broader tests.
7. Check original issue plus adjacent states/routes/components likely to regress.
8. Review for regressions, security, performance, accessibility, and maintainability.
9. For long/multi-session work, use Project Memory for compact handoff.
10. Summarize what changed, what was verified, and remaining risk.

## Standards

- Preserve existing design system and conventions.
- Avoid overengineering. Add abstraction only when reuse is real.
- Do not silently weaken validation, auth, permission, billing, or data integrity.
- Prefer explicit failure handling over optimistic success paths.
- Keep user-facing copy clean and product-grade.
- If obvious nearby breakage appears during testing, fix safe related issues or document evidence.
