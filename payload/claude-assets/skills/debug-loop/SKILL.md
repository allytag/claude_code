---
name: Debug Loop
description: Structured debugging workflow. Use when errors, failing tests, broken builds, unexpected model/provider failures, runtime crashes, or flaky behavior appear.
allowed-tools: Read, Bash, Edit, MultiEdit
---

# Debug Loop

Use this skill to debug without guessing.

## Process

1. Reproduce or locate exact failure: command, log line, stack trace, status code, timestamp.
2. Identify boundary: app code, dependency, environment, provider, config, network, data.
3. Form one hypothesis at a time.
4. Inspect smallest relevant files/logs.
5. Patch minimally.
6. Re-run the same failing check.
7. Add a regression test or guard when feasible.

## Rules

- Do not mask errors with broad catch blocks.
- Do not delete state/cache unless evidence points there.
- Do not change unrelated config.
- If provider/model issue, capture finish reason, status, provider, tokens, latency, and retry behavior.
