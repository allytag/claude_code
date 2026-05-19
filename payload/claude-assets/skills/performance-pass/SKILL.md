---
name: Performance Pass
description: Use for slow pages, large bundles, slow APIs, database performance, caching, rendering jank, long sessions, and production-readiness polish.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Performance Pass

Use this skill when speed, scale, or cost matters.

## Web/UI

- Avoid unnecessary client components and heavy libraries.
- Split large components by responsibility.
- Use image sizing, lazy loading, and stable layout boxes.
- Avoid layout thrash and expensive animation.
- Add loading skeletons where latency is visible.

## Backend

- Check N+1 queries and missing indexes.
- Move repeated expensive work behind cache when safe.
- Add pagination/limits on list endpoints.
- Keep external API calls timeout-bound and retry-safe.
- Log latency at useful boundaries, not full payloads.

## Verification

Use available tooling: build output, bundle analyzer if present, query explain if available, targeted timing logs. Report measurable before/after when possible.
