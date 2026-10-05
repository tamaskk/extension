---
paths:
  - "apps/*/components/**"
  - "apps/*/app/**/*.tsx"
  - "apps/*/app/globals.css"
---

# UI components

- Before creating or changing UI, read docs/DESIGN_SYSTEM.md if you have not in this session. Each app has its own token set; use the one of the app you are in.
- Colors come from the app's CSS variables. Do not add a new raw hex value. Spacing, radius and font sizes: use a value the neighbouring rules already use.
- Styling is global CSS classes in the app's `app/globals.css`. No Tailwind, CSS modules or CSS-in-JS. In `apps/web`, reuse the class prefix of the area (`.side-*`, `.ld-*`, `.rvp-*`, ...); a new area gets a new short prefix.
- Reuse existing components first (`ComboFilter`, `CategoryFilter`, `TagsCell`, `IconPicker`, the modal pattern). A new shared component needs a DESIGN_SYSTEM.md §06 entry in the same change.
- One component per PascalCase file, default export, in the flat `components/` folder.
- Every data-driven view has loading, empty and error states.
- Modals close on overlay click and on Escape.
- Icons: emoji or Unicode glyphs in web; `Icon*` components from `components/Icons.tsx` in tokenleads. Icon-only buttons need a `title` or `aria-label`.
- `apps/web` is a desktop tool; keep the existing `max-width` rules working and reuse an existing breakpoint. `apps/landing` and `apps/tokenleads` must work at 375px.
- Components fetch through `lib/api.ts`, never with a bare `fetch` to `/api/...` and never by importing server modules.
- `"use client"` only where state, effects or browser APIs are needed.
- UI copy: English in web and landing, Hungarian first in tokenleads. Plain, short, no exclamation marks.
