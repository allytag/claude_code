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
- Treat Core Web Vitals as product requirements: LCP for first useful content, INP for interaction latency, CLS for layout stability.
- Watch bundle size. Prefer route-level code splitting, dynamic import for rare panels, and removing unused libraries before adding memoization.
- Memoize only when there is measured repeated work or unstable object identity causing real rerenders. Do not blanket `memo`, `useMemo`, or `useCallback`.
- Virtualize long lists, debounce expensive input flows, and move non-visual work off the hot render path.
- Keep animations GPU-friendly: transform/opacity first, no layout-triggering animation for large regions.
- Use responsive image sizes, modern formats, preload only critical media, and lazy-load below-the-fold assets.

## Backend

- Check N+1 queries and missing indexes.
- Move repeated expensive work behind cache when safe.
- Add pagination/limits on list endpoints.
- Keep external API calls timeout-bound and retry-safe.
- Log latency at useful boundaries, not full payloads.
- Set response budgets per path: fast UI APIs should normally target sub-second server time before network.
- Inspect query plans for slow or high-cardinality queries. Add indexes for actual filters, joins, and sort order, not guessed columns.
- Prefer bounded fanout. Batch or prefetch related records instead of per-row calls.
- Use cache tiers deliberately: CDN for public/static, app cache for reusable computed data, DB/cache store for shared state. Define invalidation before adding cache.
- Make expensive background work observable with queue depth, duration, retry count, and dead-letter signals.

## Measurement Commands

Use project tooling when present. Examples:

```sh
EXPLAIN ANALYZE <query>;
npm run build
npx lighthouse http://localhost:3000 --view
```

For bundle analysis, use the repo's existing analyzer script first. If none exists, propose adding one before changing build config.

## Performance Budget

- Name the bottleneck before optimizing: render, bundle, network, server, database, third-party, or cache miss.
- Record baseline and after numbers when possible.
- Do not trade correctness, security, or accessibility for speed.
- If a change only improves synthetic speed while hurting user flow or maintainability, reject it.

## Verification

Use available tooling: build output, bundle analyzer if present, query explain if available, targeted timing logs, web-vital reports, and provider dashboards. Report measurable before/after when possible.
