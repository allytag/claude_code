---
name: Test Strategy
description: Use when adding features, fixing bugs, preparing release, refactoring, or when confidence matters. Designs and runs minimal high-value tests without wasting time.
allowed-tools: Read, Grep, Glob, Bash, Edit, MultiEdit, Write
---

# Test Strategy

Use this skill to get confidence with minimal test cost.

## Test Selection

1. Start with nearest existing test pattern.
2. Cover changed behavior first, not implementation details.
3. Add one regression test for the bug when possible.
4. Prefer small deterministic tests over broad brittle suites.
5. Run targeted tests before full suite.
6. If tests cannot run, state exact blocker and safest manual verification.

## Coverage Targets

- Core success path.
- Failure path likely to break.
- Boundary values.
- Auth/permission edge when security relevant.
- UI state: loading, empty, error, success.

## Final Verification

Report:

- Commands run.
- Passed/failed.
- Coverage gap.
- Residual risk.
