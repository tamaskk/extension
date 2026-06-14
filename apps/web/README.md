# GridLeads — Web Dashboard (`apps/web`)

A **Next.js 15** replica of the Chrome extension's dashboard — identical layout,
styling, and behaviour, running as a standalone web app.

## Features (same as the extension)

- Project sidebar with **folders** (collapse/expand, rename, delete)
- **Checkbox selection** of projects + **shift+click** range select
- **Bulk actions**: move to folder, rename, delete
- Filter chips (All / No website / Has website / Hot / Email found)
- Stat widgets (Total / No website / Hot / Emails / Avg opportunity)
- Sortable table (click any column header; ▲/▼ indicators) + sort dropdown
- **Checked** column, persisted per business
- **Duplicates** modal: per-group **⚡ Fix it**, **⚡ Fix all**, checkbox +
  shift-click multi-delete, click a project name to jump to it
- Resizable sidebar (drag the right edge; width persisted)
- CSV export

## Data — MongoDB

The dashboard reads/writes everything through a **MongoDB** backend (Mongoose).
Set the connection string in `.env`:

```
MONGODB_URI=mongodb+srv://...
```

Collections: `folders`, `projects`, `leads` (leads are a separate collection,
unique on `{project, dedupKey}`, so it scales past the 16MB-per-document limit).

### API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/folders` `/api/projects` `/api/leads?project=` | the dashboard reads from here |
| POST | `/api/sync` | **the extension pushes a bundle** (a project, a folder's projects, or everything) — upsert |
| POST | `/api/leads` | add a single lead (`{project, lead}`) one-by-one |
| PATCH/DELETE | `/api/projects` `/api/folders` `/api/leads` | the dashboard's edits persist to the DB |

All endpoints send permissive CORS headers so the Chrome extension can call them.

### Syncing from the extension

In the extension dashboard:
- **⟳ Sync all** (sidebar header) → pushes every project to the web DB
- **⟳** on a folder → syncs that folder's projects
- Select projects → **Sync** (bulk bar) → syncs the selection

The extension posts to `http://localhost:3000/api/sync` (change `SYNC_BASE` in
`apps/extension/dashboard/dashboard.js` for a deployed web app, and add the host
to the extension's `host_permissions`).

## Run

```bash
cd apps/web
npm install
npm run dev      # http://localhost:3000
```

## Structure

```
app/
  layout.tsx          # html shell + globals.css (the extension's CSS, verbatim)
  page.tsx            # renders <Dashboard/>
  globals.css
components/
  Dashboard.tsx       # the full dashboard (sidebar, topbar, table, widgets)
  DuplicatesModal.tsx # duplicate finder + Fix it / Fix all
lib/
  types.ts            # Lead / Project / Folder types
  scoring.ts          # lead + opportunity scoring (port of the extension engine)
  store.ts            # Zustand store (localStorage) + selectors + CSV export
  seed.ts             # demo dataset (with folders + duplicates)
```
