---
description: Run final quality, security, test, and UX release check.
argument-hint: [scope]
allowed-tools: Read, Bash
---

# Release Check

Scope: $ARGUMENTS

Do not edit files unless explicitly asked. Inspect and report.

Check:

- Build/test status
- Security-sensitive paths
- UI states and responsive risk
- API contract risk
- Performance risk
- Missing docs/env/migrations
- Highest-priority fixes before release
