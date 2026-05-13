---
name: SaaS Architecture
description: Production SaaS architecture workflow. Use when designing full-stack products, auth, billing, dashboards, admin panels, multi-tenant systems, APIs, databases, queues, deployment, or scaling plans.
allowed-tools: Read, Grep, Glob, Bash, Edit, MultiEdit, Write
---

# SaaS Architecture

Use this skill before building large product systems.

## Architecture Checklist

1. Product model: users, roles, tenants, plans, permissions, lifecycle.
2. Data model: ownership, constraints, indexes, migrations, retention.
3. API boundaries: validation, authorization, rate limits, idempotency.
4. UI flows: onboarding, empty states, billing states, errors, admin controls.
5. Background work: queues, retries, observability, dead-letter handling.
6. Security: secrets, PII, audit logs, least privilege.
7. Operations: config, backups, logs, metrics, alerts, deploy/rollback.

## Rule

Design for the next real milestone, not imaginary enterprise scale. Keep upgrade paths clear.
