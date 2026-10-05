# GridLeads

Google Maps lead generation for one operator: a Chrome extension scrapes local businesses, a web dashboard scores them by how much website work they need, and the operator researches contacts, writes outreach, sends email and places AI calls from there.

> Every lead carries a **website status** and an **opportunity score (0–100)**, so the list is sorted by who to contact first.

## Monorepo at a glance

| Path | What it is |
|------|------------|
| [apps/web](apps/web/README.md) | The dashboard. Next.js 16 (App Router), React 19, Mongoose, zustand. Production: https://gridleads-wheat.vercel.app |
| [apps/extension](apps/extension/README.md) | Manifest V3 Chrome extension: Google Maps scraper, batch runner, local dashboard, sync |
| [apps/extension-reviews](apps/extension-reviews/README.md) | Manifest V3 Chrome extension: Google review scraper |
| [apps/landing](apps/landing) | Marketing page with live counters (Next.js 16) |
| [apps/tokenleads](apps/tokenleads/ROADMAP.md) | TokenLeads, a separate product: token-based lead marketplace that reads the GridLeads leads read-only |
| [packages/scoring](packages/scoring/index.ts) | TypeScript scoring library. Not imported by any app today |

There is no root `package.json` and no workspace. Each Next.js app has its own `package.json`; the extensions have no build step.

## Documentation

| File | What it answers |
|------|-----------------|
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents and the command reference |
| [docs/PRD.md](docs/PRD.md) | What the product is, for whom, what is out of scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the apps connect, where code goes, intentional decisions |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | The design tokens and UI conventions of each app |
| [docs/SECURITY.md](docs/SECURITY.md) | Data, trust boundaries, known gaps |
| [docs/TASKS.md](docs/TASKS.md) | Open tasks |
| [docs/archive/](docs/archive/) | The original NestJS / PostgreSQL / BullMQ plan. It was never built; kept for reference only |

## Quickstart

```bash
# dashboard (http://localhost:3000)
npm --prefix apps/web install
npm --prefix apps/web run dev

# other apps: tokenleads on :3010, landing on :3020
npm --prefix apps/tokenleads install && npm --prefix apps/tokenleads run dev
npm --prefix apps/landing install && npm --prefix apps/landing run dev
```

Each app reads its settings from an untracked `.env` file; the variable names are in `apps/<app>/.env.example` and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §09. There is no separate development database: a local dashboard works on the production data.

Extensions: open `chrome://extensions`, enable Developer mode, **Load unpacked**, and pick `apps/extension` or `apps/extension-reviews`. Reload the extension after a code change.

## Checks

```bash
npm --prefix apps/web run typecheck        # also: landing, tokenleads
npm --prefix apps/web run build
npm --prefix apps/tokenleads run test      # Vitest
node --test apps/web/lib/organize.test.mjs
```

## Deploy

The Next.js apps are deployed to Vercel with the CLI from the app folder (`vercel deploy --prod`). There is no Git integration and no CI.
