---
name: API Contract
description: Use for backend routes, API design, validation, database interactions, auth boundaries, response shapes, typed clients, error models, and integration-safe changes.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# API Contract

Use this skill when changing backend/API behavior.

## Contract Rules

1. Identify caller and consumer before changing route behavior.
2. Preserve existing response shape unless migration is intentional.
3. Validate inputs at boundary. Do not trust client-only checks.
4. Return typed, predictable errors: code, message, field when useful.
5. Keep authn/authz checks explicit and close to sensitive operations.
6. Check transaction/idempotency needs before writes, payments, webhooks, or retries.
7. Avoid leaking internal errors, stack traces, secrets, or provider details.
8. Add or update tests for success, validation failure, auth failure, provider failure, and edge case.

## Change Checklist

- Route/method/path
- Request body/query/params
- Response schema
- Error schema
- Auth requirements
- Rate/abuse risk
- Database transaction needs
- Idempotency/retry behavior
- Backward compatibility
- Client updates
- Tests
