---
name: ui-component
description: Build or change a React UI component the project's way - the app's own CSS variables from docs/DESIGN_SYSTEM.md, global CSS classes, reuse of existing components, all states. Use when creating or modifying components or pages in apps/web, apps/landing or apps/tokenleads.
paths:
  - "apps/*/components/**"
  - "apps/*/app/**/*.tsx"
---

# UI component workflow

1. Read docs/DESIGN_SYSTEM.md if you have not in this session. Note which app you are in: web, landing and tokenleads each have their own tokens, fonts and icon approach.
2. List the app's `components/` folder. Reuse, then compose, then create. A new shared component only if nothing fits: ask first, and add it to DESIGN_SYSTEM.md §06 in the same change.
3. Styles go in the app's `app/globals.css` as classes. In web, use the area's existing prefix or a new short one. Colors through CSS variables only; sizes, gaps and radii from the values already used nearby.
4. One PascalCase file, `export default function Name`, `'use client'` only if it needs state, effects or browser APIs.
5. Data goes through `lib/api.ts` (web). Add the wrapper there if the endpoint is new.
6. States: default, hover, focus-visible, active, disabled, loading. Data views: loading, empty, error.
7. Modals: close on overlay click and Escape.
8. Accessibility: semantic elements, labels, `title` or `aria-label` on emoji and icon-only buttons.
9. Width: web is desktop first, reuse an existing `max-width` breakpoint. landing and tokenleads: check 375px.
10. Verify: `npm --prefix apps/<app> run typecheck`. If the `claude-in-chrome` tools or bundled `/verify` are available and the dev server is running, look at the page; remember the dev server shows production data, so do not click anything that writes.
