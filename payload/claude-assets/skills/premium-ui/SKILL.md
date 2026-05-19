---
name: Premium UI
description: Use for high-end UI, SaaS dashboards, landing pages, product websites, mobile responsive UI, visual redesign, UI polish, empty/loading/error states, motion, typography, and design quality rescue.
allowed-tools: Read, Bash, Edit, MultiEdit, Write
---

# Premium UI

Use this skill to produce non-generic, production-grade visual work.

## Visual Direction First

Before coding, choose:

- Product personality: precise, warm, editorial, technical, playful, luxury, enterprise.
- Visual system: typography scale, spacing rhythm, radius, borders, shadows, color temperature.
- Layout strategy: hero hierarchy, content density, scan path, interaction priority.
- State strategy: loading, empty, error, success, disabled, long content.

## Premium Interface Design

- Layout: create a deliberate composition, not a stacked template. Use asymmetric hero structure, strong section rhythm, and clear scan paths when appropriate.
- Typography: choose expressive hierarchy with intentional display/body contrast, line height, max width, and numeric/data styling.
- Color: define a focused palette with semantic tokens. Use gradients, texture, or depth only when they support the product mood.
- SaaS dashboards: prioritize decision speed. Surface primary metrics, deltas, filters, empty states, and drill-down paths without visual clutter.
- Landing pages: make the promise, proof, and conversion path visible above the fold; support it with credible product-specific details.
- Mobile UX: design thumb-safe actions, collapsed navigation, readable tables/cards, and no horizontal overflow.
- Motion: use transitions to explain hierarchy, loading, or state changes. Respect reduced motion and avoid decorative noise.
- Screenshot QA: inspect the rendered page at desktop and mobile widths for alignment, contrast, spacing, overflow, broken states, and generic-looking sections.

## Build Rules

1. Avoid interchangeable AI UI. No random purple gradients, generic cards, or meaningless icons.
2. Use semantic components and design tokens/CSS variables.
3. Make mobile first-class, not afterthought.
4. Use motion sparingly for hierarchy/state, respect reduced motion.
5. Add accessibility basics: focus, labels, contrast, keyboard path.
6. Check actual rendered layout when local app can run.
7. Scan whole visible page after change, not only edited component.
8. Capture obvious nearby UI regressions with route/component/evidence; fix only when safe and related.

## Quality Gate

Before final:

- Above-fold story clear in 5 seconds.
- Primary action visible and specific.
- Typography sizes and weights intentional.
- Spacing consistent across sections.
- No broken responsive widths.
- Empty/loading/error states not forgotten.
- Design feels specific to product domain.
- Long content does not crop, overflow, or cause layout jump.
- Hover/focus/disabled states match visual system.
