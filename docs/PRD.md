# PRD: GridLeads

Status: Draft · Last updated: 2026-10-05

## 01 Product overview

| Field | Value |
| --- | --- |
| Product name | GridLeads |
| Tagline | Google Maps leads, scored and ready to pitch |
| Description | A Chrome extension scrapes local businesses from Google Maps and syncs them to a web dashboard. The dashboard scores each business by how much website work it needs, and lets the operator research contacts, write outreach, send email and place AI calls. |
| Stage | Live (internal tool, one operator) |
| Platform | Web app (Next.js dashboard) + two Chrome MV3 extensions + a marketing landing page |

## 02 Problem

Finding local businesses that have no website, or a broken one, means searching Google Maps city by city, copying names and phone numbers by hand, opening every listing to check its site, and then keeping track of who was already contacted in a spreadsheet. (assumed — confirm)

Today, the operator has to collect and qualify leads by hand because Google Maps has no export and no notion of "this business needs a website".
This costs them hours per city and leads that are contacted twice or never.

## 03 Goal

Help the operator go from a Maps search to a qualified, contactable lead list in minutes without manual copying or a spreadsheet. (assumed — confirm)

## 04 Target users

Primary user:
- Who: the owner of this repository, selling website and marketing work to local businesses. Single login.
- Trigger: starting outreach in a new city, region or business category.
- Today they use: this tool. Before it: Google Maps plus a spreadsheet.
- They will switch because: every lead carries a website status and an opportunity score, so the list is sorted by who to call first.

Not for:
- Teams or paying customers. There is one account, no roles and no billing in GridLeads.
- People who want to buy leads. That is TokenLeads (see "Related product").

## 05 Core features

All of these exist today. "Done when" is the behaviour that must keep working.

| # | Feature | What the user can do | Done when |
| --- | --- | --- | --- |
| F1 | Maps scraping | Run a Maps search, or a batch of searches across several windows, with the extension | Every business in the result list is stored once per project with name, category, rating, phone, website, address and coordinates |
| F2 | Sync to the dashboard | Push scraped projects to the web app, manually or as a stream | `POST /api/sync` upserts the leads; a business that already exists in another project is not duplicated |
| F3 | Scoring | See website status, lead score, temperature and opportunity score per lead | Scores are computed at sync and can be recomputed for a project from the dashboard |
| F4 | Organize and filter | Group projects in nested folders; filter, sort, search, tag and check leads; find duplicates; view leads on a map | The lead table pages on the server and a filter change returns results for a project of 100,000 leads without a timeout (assumed — confirm) |
| F5 | Reviews | Scrape up to 100 Google reviews per business with the review extension and read them in the lead panel | Reviews appear on the lead's Reviews tab and the business is marked as scraped |
| F6 | Outreach | Generate an email or SMS draft, research a contact email, send the email | The sent email is recorded on the lead with recipient and time, and appears in the activity log |
| F7 | Calls | Flag leads for calling, place an AI call to a group, replay the recording and transcript | The call appears on the lead's Call tab with its end reason and playable recording |
| F8 | Import and export | Export a project as a bundle or spreadsheet, import a bundle | An exported bundle imports into an empty database with the same lead count |

Key user flow:
1. The operator runs a batch of Maps searches in the extension for a region and business type.
2. The leads sync to the dashboard, are scored, and are organized into folders.
3. The operator filters to hot leads without a website, generates and sends outreach, and logs the result on the lead.

## 06 Success metrics

| Metric | Target | Measured by |
| --- | --- | --- |
| Leads with a contact email | 30% of synced leads (assumed — confirm) | `ProjectStat.email / ProjectStat.total` |
| Outreach emails sent per week | 100 (assumed — confirm) | activity log, type email sent |
| Calls booked per week | 5 (assumed — confirm) | leads with a sales status and date set |

## 07 Out of scope

- Billing, plans, roles, more than one user account, multi-tenant data.
- The NestJS, PostgreSQL, Prisma and BullMQ platform described in docs/archive/. It was never built.
- Sending SMS. Drafts are generated; there is no SMS provider.
- Native mobile apps.
- A build step, bundler or framework for the extensions.

## 08 Open questions

- Is the problem statement in §02 and the goal in §03 right? (assumed — confirm)
- Are the three metrics in §06 the right ones, and are the targets realistic? (assumed — confirm)
- Is `packages/scoring` the planned single source for scoring, or legacy? Today nothing imports it and the logic is duplicated in `apps/web/lib/scoring.ts` and `apps/extension/lib/scoring.js`.
- Which list of "no real website" statuses is correct: the 6 in `apps/web/lib/models.ts` or the 8 in the scoring files?
- Should commit messages keep the current sentence style or move to Conventional Commits? AGENTS.md §09 documents the current style. (assumed — confirm)
- Which Vercel projects serve `apps/landing` and `apps/tokenleads`, and at which URLs?

## 09 Glossary

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| Project | One Google Maps search query and the leads it returned. Keyed by the query string. | Folder |
| Folder | A user-made, nestable group of projects | Lead group |
| Lead | One business. Lives in exactly one project; identified by `dedupKey`. | Review |
| Lead group | A named list of `dedupKey`s across projects, used for calls | Folder |
| Website status | The classification of a lead's website: none, social only, broken, parked and so on | Lead score |
| Lead score | 0 to 100 quality of the business as a lead | Opportunity score |
| Opportunity score | 0 to 100 estimate of how much website work can be sold to the lead | Lead score |
| Temperature | hot, warm or cold bucket derived from the scores | Sales status |
| Sync | The extension uploading its local projects to the web app | Import |
| Stream mode | Sync after every finished search, then delete the local copy | Local mode |

## Related product: TokenLeads

`apps/tokenleads` is a separate product in this repository: a multi-user marketplace where customers spend tokens to unlock leads. It has its own database, login, design and Hungarian-first UI, and reads the GridLeads lead collection read-only. Its scope and plan live in `apps/tokenleads/ROADMAP.md` and `apps/tokenleads/IMPLEMENTATION-PLAN.md`, not in this PRD.
