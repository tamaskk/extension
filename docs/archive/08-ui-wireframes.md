# 08 — UI, Wireframes & User Flows

Design target: cleaner and more modern than LeadsMap — the data density of Apollo/Clay, the polish of Linear/Attio. Stack: Next.js 15 App Router · TailwindCSS · Shadcn/UI · TanStack Query (server state) · Zustand (table selection, filters, UI). Subtle glassmorphism on overlays only; full dark + light mode via CSS variables / `next-themes`.

## 1. Dashboard shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌───────────────┐ ┌──────────────────────────────────────────────────────────┐│
│ │  GridLeads ▾  │ │ Search campaigns, businesses, contacts…   ⚙  ⤓ Export  ⟳ ││  ← TOP BAR
│ ├───────────────┤ ├──────────────────────────────────────────────────────────┤│
│ │ + New Campaign│ │ [Filters ▾]   Sort: Newest ▾        [⚡ Scrape Contacts]  ││
│ │               │ ├──────────────────────────────────────────────────────────┤│
│ │ CAMPAIGNS     │ │ ☐ Business        Cat   ★   Rev  Phone  Email  Web  Opp ⋮ ││  ← sticky header
│ │ • NYC Rest..  │ │ ☐ Joe's Pizza     Rest  4.2  31   ☎     ✉95   ✕   ▓88  …  ││
│ │ • Dentists Mi │ │ ☐ Bright Smile    Dent  4.8  210  ☎     —     ✓   ▓40  …  ││
│ │ • Roofers Dal │ │ ☐ Apex Roofing    Roof  4.1  12   ☎     ✉80  FB   ▓92  …  ││
│ │ • Coffee Lon  │ │ … virtualized, infinite scroll, 100k+ rows …             ││
│ │ • Plumbers Be │ │                                                          ││
│ │  ───────────  │ │ [3 selected]  Tag ▾  Stage ▾  Assign ▾  Enrich  Export   ││  ← bulk bar
│ │ Analytics     │ │                                                          ││
│ │ Outreach      │ │                                                          ││
│ │ Settings      │ │                                                          ││
│ └───────────────┘ └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Left sidebar:** campaign list with right-click / `⋮` menu → Create, Duplicate, Rename, Delete, Archive. Counts (total / qualified) per campaign. Nav to Analytics, Outreach, Settings.
- **Top bar:** global search, Filters, Sort dropdown (Newest, Oldest, Highest/Lowest Rating, Most Reviews, + Opportunity Score), Refresh, Settings, Export, **Scrape Contacts**.
- **Main table:** columns = ☐, Business, Category, Rating, Reviews, Phone, Email, Website (status chip), **Opportunity** (score bar), Status (pipeline), Location, Tags, Created, Actions. Sticky header, virtualized rows (TanStack Virtual), server-side cursor pagination + infinite scroll, multi-select with a sticky bulk-action bar.

## 2. Website status & score chips

- **Website status chip:** color-coded — green `Has site`, red `No website`, blue `Facebook only`, pink `Instagram only`, amber `Broken/Parked/Construction`. Tooltip shows the probe detail + last checked.
- **Temperature pill:** Cold (slate), Warm (amber), Hot (red), with the numeric lead score.
- **Opportunity bar:** 0–100 horizontal bar; hover reveals the ranked auto-pitches from the engine.

## 3. Lead detail (drawer / route)

Slides over the table: thumbnail, name, category, rating + reviews, phone, website + status, address, coordinates (mini map), opening hours, tags, **Lead Score breakdown** (each rule + points), **Website Opportunity** panel (score + pitch list), contacts with confidence dots, CRM tabs: Notes · Tasks · Activity timeline · Pipeline stage · Owner · Custom fields.

## 4. Other surfaces

- **Pipeline board:** kanban across New → Contacted → Interested → Meeting → Proposal Sent → Negotiation → Won → Lost; drag updates `pipelineStage` (optimistic via Zustand + TanStack mutation).
- **Filters panel:** No/Has/Broken website, Facebook-only, Instagram-only, rating, review count, country/city, industry, email/phone/social found, lead score range, Hot/Cold, **min Opportunity score**. Saved filter views per campaign.
- **Export modal:** format (CSV/Excel/Sheets/JSON/Webhook), checkbox field selector, "current filter" vs "selection," row-count preview.
- **Analytics:** widget grid (total campaigns, total leads, leads without websites, emails found, phones found, hot leads, conversion rate, export count, revenue) + line/bar trend charts (Recharts) + a geo heat map of leads.
- **Outreach:** sequence builder (steps, delays, templates with `{{variables}}`), enrollment, open/click/reply stats, unsubscribe management.

## 5. Performance UX

Virtualized tables, skeleton loaders, optimistic mutations, debounced search, prefetch-on-hover for the detail drawer, `keepPreviousData` so filter/sort changes don't flash empty. Targets: sub-second filtered table loads at 100k+ rows; interaction-to-paint under 100ms for selection/sort.

## 6. Core user flows

1. **Scrape → qualify:** install extension → search Maps → pick campaign → Start → rows stream into the table with live status/scores → filter `No website + Hot + Opportunity > 70` → bulk Enrich → Export.
2. **Work the pipeline:** open Hot lead → read auto-pitch → call → log note → move to Contacted → create follow-up task.
3. **Outreach:** select filtered Hot leads with email → enroll in a sequence → track opens/replies → move repliers to Interested.
