---
description: Diagnose and fix bug with evidence-first loop.
argument-hint: [error/bug]
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Debug Loop

Bug: $ARGUMENTS

Use Debug Loop and Test Strategy.

Rules:

1. Reproduce or locate failing path.
2. Identify smallest root cause.
3. Patch minimal safe fix.
4. Add regression test if feasible.
5. Verify. If not verified, state exact blocker.
