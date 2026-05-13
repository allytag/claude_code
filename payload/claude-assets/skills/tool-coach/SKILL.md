---
name: Tool Coach
description: Use automatically for Claude Code work involving files, tools, bash, edits, tests, long commands, failed tool calls, or unfamiliar repos. Improves tool choice, prevents loops, and keeps work high-quality without adding broad context.
allowed-tools: Read, Grep, Glob, Bash
---

# Tool Coach

Use this skill to choose tools deliberately and avoid wasteful or unsafe loops.

## Tool Discipline

1. Use `Glob`/`Grep` before broad reads.
2. Use `Read` before `Edit`/`MultiEdit`.
3. Use `Edit` for small precise changes; `MultiEdit` for several edits in one file; `Write` only for new files or full rewrites.
4. Use `Bash` for targeted verification, not blind full-suite runs unless needed.
5. Never paste huge logs. Use `tail`, filters, or targeted grep.
6. If a command fails twice, stop and diagnose root cause. Do not loop.
7. For long commands, state command, expected signal, timeout/log path, and next check.
8. For unfamiliar repo work, call or follow Context Intelligence first.
9. For UI work, run Premium UI review before final.
10. For release-risk work, call Test Strategy and Security Hardening.

## Long Command Pattern

Prefer:

```sh
mkdir -p /tmp/claude-lts-jobs
command > /tmp/claude-lts-jobs/<name>.log 2>&1 &
echo $!
```

Then check:

```sh
ps -p <pid> -o pid,etime,command
tail -n 80 /tmp/claude-lts-jobs/<name>.log
```

Use this only when background execution is actually useful. Otherwise run normally and wait.

## Quality Rule

Do not reduce correctness, tests, or security to save tokens. Reduce waste by narrowing context and running focused checks.
