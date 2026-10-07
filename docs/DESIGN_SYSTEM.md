# Design System: GridLeads

This file records the visual decisions that exist in the code today. Nothing here is aspirational except the section marked "Target (not yet true)". The three web apps do not share one token set: use the set of the app you are working in, and never copy a token name from another app.

## 01 Brand identity

- Personality: dense, fast, utilitarian (assumed — confirm)
- Tone in UI copy: plain, short labels, no exclamation marks.
- Feel: a data tool. Small type, tight spacing, many rows on screen.
- UI language and locale: English in `apps/web`, `apps/landing` and both extensions. Hungarian first in `apps/tokenleads` (partial hu/en dictionary in `lib/i18n.ts`).
- Reference: the light theme of `apps/web` is modelled on mapileads (comment in `apps/web/app/globals.css`).

## 02 Color palette

### apps/web (light, the only effective theme)

Defined in the second `:root` block of `apps/web/app/globals.css`. The first `:root` block is the dark extension palette, kept verbatim and overridden; do not remove it (ARCHITECTURE §06).

| Token | Value | Use |
| --- | --- | --- |
| --bg | #eef1fb | Page background (under a fixed gradient on `body`) |
| --panel | #ffffff | Panels, modals, table |
| --panel2 | #f3f5fc | Inputs, secondary panels, hover rows |
| --line | #e7e9f3 | Borders, dividers |
| --text | #1c2030 | Body text |
| --muted | #6c7388 | Secondary text |
| --accent | #6366f1 | Buttons, links, active state |
| --ink | #4f46e5 | Darker accent for text on light accent backgrounds |
| --hot | #f43f5e | Hot leads, destructive actions |
| --warm | #f59e0b | Warm leads, warnings |
| --cold | #94a3b8 | Cold leads |
| --ok | #22c55e | Success |
| --shadow | 0 12px 34px rgba(31,41,68,.10) | Floating panels |

Runtime layout variables set from JavaScript: `--sw` (sidebar width, default 264px), `--pw` (panel width).

### apps/extension and apps/extension-reviews (dark only)

Defined at the top of `apps/extension/dashboard/dashboard.css`; `popup.css` in both extensions repeats an 8-token subset. `apps/extension/lib/pages.css` reuses the dashboard variables.

| Token | Value |
| --- | --- |
| --bg | #0b0d12 |
| --panel | #141822 |
| --panel2 | #1a1f2e |
| --line | #232838 |
| --text | #e6e8ee |
| --muted | #8b90a0 |
| --accent | #6366f1 |
| --hot | #f43f5e |
| --warm | #f59e0b |
| --cold | #64748b |
| --ok | #22c55e |

### apps/tokenleads

Its own set in `apps/tokenleads/app/globals.css`: `--bg`, `--card`, `--line`, `--line2`, `--text`, `--muted`, `--faint`, `--accent` (#6366f1), `--accent-deep`, `--grad`, `--ok`, `--ok-bg`, `--ok-text`, `--bad`, `--bad-bg`, `--bad-text`, `--info-text`, `--info-bg`, `--warn`, `--input-bg`, `--side-hover`, `--th-bg`, `--row-hover`, `--shadow`, `--shadow-lg`, `--r` (16px). Real dark mode through `html[data-theme="dark"]`, stored in `localStorage` key `tl_theme`.

### apps/landing

Its own set in `apps/landing/app/globals.css`: `--bg` (#f3f1ec), `--ink`, `--muted`, `--line`, `--card`, `--r` (22px), pastels `--pink`, `--peach`, `--lav`, `--blue`, `--yellow`, and `--violet` (#7a5cff). Light only.

Rules:
- Use a token when one exists for the role. New raw hex values need approval.
- Known debt in `apps/web/app/globals.css`: `#4f46e5`, `#e11d48`, `#2563eb` and `#15803d` appear raw many times. Do not add more; do not mass-replace them unless the task is about that.
- Dark mode: not supported in `apps/web` and `apps/landing`. Supported in `apps/tokenleads`. The extensions are dark only.

## 03 Typography

| App | Font | Base size | Scale in use |
| --- | --- | --- | --- |
| web, extensions | System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`. Mono: `ui-monospace, SFMono-Regular, Menlo, monospace` | 13px | 10, 11, 12, 13px for almost everything |
| tokenleads | Plus Jakarta Sans through `next/font` (`--font-sans`) | see its globals.css | — |
| landing | Schibsted Grotesk (`--display`), Instrument Sans (`--body`), Spline Sans Mono (`--mono`) through `next/font` | see its globals.css | — |

Rules:
- No web fonts in `apps/web` or the extensions.
- Do not introduce a size outside the scale already used in the file you are editing.

## 04 Spacing

There are no spacing tokens. Values in use in `apps/web`:

- Gaps: 6, 8, 10, 12px.
- Padding pairs: `7px 9px`, `8px 10px`, `9px 12px`, `12px 14px`.

Rule: pick the value the neighbouring rules use. Do not introduce a new one.

## 05 Border radius and shadows

No radius tokens in `apps/web`. Values in use: 6px (tags, small controls), 8px (inputs, buttons), 10px (cards, dropdowns), 18px (main floating panels). `apps/tokenleads` and `apps/landing` use `--r`.

Shadows in `apps/web`: `var(--shadow)` for floating panels; `0 12px 32px rgba(31,41,68,.12)` for menus. Inset 2 to 3px accent bars mark the active row or tab.

## 06 Components

There is no shared primitive library and no `components/ui` folder. Components are feature-level React files in a flat `components/` folder per app, styled by global CSS classes.

- `apps/web`: sidebar rows have fixed heights (project row 33px, folder row 34px, 4px gap; `.side-rows` in `globals.css`). The list is windowed and positions rows by these numbers, so a row must stay one line.
- `apps/web`: classes carry a short prefix per area: `.side-*` (sidebar), `.navrail-*`, `.crail-*`, `.combo-*` (combo filter), `.ld-*` (lead detail), `.rvp-*` (review panel), `.vapi-*`, `.log-*`, `.mp-*` (map). Reuse the existing prefix of the area; a new area gets a new prefix.
- Existing building blocks to reuse before writing a new one: `ComboFilter`, `CategoryFilter`, `TagsCell`, `IconPicker`, and the modal pattern used by `StatsModal`, `MapModal`, `DuplicatesModal`.
- Modals close on overlay click and on Escape.
- `PlacePickerModal` (web): a map to pick a country, a US state or a city, each label with the local time, green during sending hours. Leaflet comes through `lib/leafletLoader.ts`; do not load it another way.
- `EmailPreviewModal` (web): the emails of a sequence as one lead gets them, footer included. Use it wherever "what will go out" is shown; do not render sequence text another way.
- Inline `style={{}}` is tolerated for one-off layout values. `apps/web/app/login/page.tsx` is fully inline-styled.
- `apps/tokenleads`: `components/Shell.tsx` is the page frame; icons come from `components/Icons.tsx`.

If a variant you need does not exist, ask before adding it.

## 07 Icons

- `apps/web` and the extensions: emoji and Unicode glyphs only. No icon library.
- `apps/tokenleads`: inline SVG components in `components/Icons.tsx`, named `Icon*`.
- An icon is never the only label on an action. Add text, a `title` or an `aria-label`.

## 08 Responsive breakpoints

`apps/web` is desktop first and uses ad hoc `max-width` queries: 560, 620, 700, 720, 760, 820, 1100 and 1300px. `apps/tokenleads` breaks at 940px. `apps/landing` breaks at 980 and 760px. The extension popup is 320px wide and has no media queries.

Rules:
- Reuse the nearest existing breakpoint in the file. Do not add a new width.
- `apps/landing` and `apps/tokenleads` must work at 375px. `apps/web` is a desktop tool: do not break the existing narrow-width rules, but 375px is not a requirement.

## 09 Motion

- `apps/tokenleads` and `apps/landing` respect `prefers-reduced-motion`. `apps/web` has only short hover and panel transitions.
- New animation needs approval.

## 10 Implementation

- Tokens live as CSS variables in each app's `app/globals.css`, and in `apps/extension/dashboard/dashboard.css` for the extension. This file and those stylesheets change in the same commit.
- No Tailwind, CSS modules or CSS-in-JS anywhere. Do not add them.
- Anything not defined here: ask before inventing it.

## Target (not yet true)

- One token file shared by `apps/web` and the extensions, replacing the duplicated `:root` blocks.
- Radius and spacing tokens in `apps/web`, and the raw accent hex values replaced by `--ink` and friends.
