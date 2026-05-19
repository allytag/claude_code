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

## Safe Database Migrations

Use expand/contract for production schema changes:

1. Expand: add new nullable columns/tables/indexes without breaking existing reads or writes.
2. Backfill: migrate data in bounded, restartable batches.
3. Switch reads: read from the new shape after backfill is verified.
4. Switch writes: write both old and new shape when needed during transition.
5. Contract: drop old columns, tables, or code paths in a later release after verification.

Avoid risky one-step migrations in live systems:

- `DROP COLUMN` while old code may still read it.
- `RENAME COLUMN` when clients or jobs may use the old name.
- Type narrowing or nullability changes before data is clean.
- Large blocking index builds; prefer concurrent/online index creation when the database supports it.
- Mixed schema and data migrations that cannot be resumed safely.

For rollback, know whether the migration is reversible. If not, deploy compatibility code first and keep a verified backup/backfill plan.

## Observability Contract

API work should expose enough operational signal without leaking payloads:

- Structured logs with request id, route, status, latency, and safe error code.
- Metrics for request count, error count, latency histogram, and queue/background durations when relevant.
- Traces/spans around slow provider, database, or payment boundaries.
- Error tracking with PII scrubbing and stable fingerprinting for repeated failures.
- On-call-friendly messages: what failed, likely boundary, and safe next check.
