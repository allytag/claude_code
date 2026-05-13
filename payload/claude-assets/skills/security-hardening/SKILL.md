---
name: Security Hardening
description: Use for auth, payments, secrets, file upload, webhooks, admin actions, database access, RLS, user-generated content, external APIs, and release review.
allowed-tools: Read, Grep, Glob, Bash, Edit, MultiEdit, Write
---

# Security Hardening

Use this skill for safety-critical code paths.

## Review Focus

1. Authn: user identity proven and session handling correct.
2. Authz: user can only access own allowed resources.
3. Secrets: no API keys, tokens, env values, or credentials in logs/client/git.
4. Injection: SQL, command, template, path traversal, SSRF, XSS.
5. Webhooks: signature verification, replay defense, idempotency.
6. Uploads: type/size checks, storage path isolation, malware risk.
7. Payments: server-side verification, no client-trusted price/status.
8. Rate limits: abuse-prone endpoints protected.

## Output

List findings by severity with file references and concrete fix. Do not invent vulnerabilities without evidence.
