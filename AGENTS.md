# AGENTS.md

Instructions for any AI coding agent working in this project
(Claude Code, Cursor, Codex, Copilot). Read this whole file before doing anything.

## 01 Purpose

GridLeads scrapes local businesses from Google Maps with a Chrome extension, scores them by how much website work they need, and gives one operator a dashboard for outreach.
The repository also holds TokenLeads (`apps/tokenleads`), a separate product that reads the same leads.
Your job is to extend these without breaking what exists, in the style already
established. When in doubt, match what is there.

## 02 Before you start

Do these in order, every session:

1. Read docs/PRD.md for what the product is and what is out of scope.
2. Before any UI work, read docs/DESIGN_SYSTEM.md. Use the tokens of the app you are in.
3. Before any structural, data or backend work, read docs/ARCHITECTURE.md for where code lives and what may touch what.
4. Check the existing components and `lib/` helpers of the app before creating a new one.
5. Look at docs/TASKS.md before proposing new work.
6. Restate the task in one or two sentences and list the files you expect
   to touch. Wait for a go-ahead if that list is longer than five files.

Ignore docs/archive/ and the root README's stack description: they describe a plan that was never built.

## 03 General rules

- Follow the design system. If a value is not in DESIGN_SYSTEM.md or the app's stylesheet, ask. Do not invent it.
- Keep code where ARCHITECTURE.md §03 puts it. Each app is self-contained: no imports across `apps/*`.
- Reuse before creating. Search the app for an existing helper or component first.
- Small, focused changes. One task, one clear diff.
- Do not add dependencies, collections, model fields, environment variables, or third-party services without asking.
- Do not delete or rewrite working code the task does not require. Do not reformat files.
- Never "improve" anything listed under intentional decisions in ARCHITECTURE.md §06.
- Leave the project runnable after every change.
- Local development runs against the production database. Do not run a script, a recalculation or a request that writes or deletes lead data unless the task says so.
- The extensions are plain JavaScript with no build step. No npm packages, no bundler, no TypeScript there.
- Logic that exists in several copies (scoring, the "no real website" status list, `SYNC_BASE`, the dark tokens) changes in all copies in the same commit.
- A change to the sync bundle or to `dedupKey` touches the extension and `apps/web/app/api/sync/route.ts` together.

## 04 Code guidelines

- TypeScript strict in the Next.js apps. Do not add new `any`; existing `any` in route handlers is known debt, leave it unless the task is about it. No `@ts-ignore` without a comment saying why.
- React components: one PascalCase file per component in the app's flat `components/` folder, `export default function Name`. Helpers in `lib/` are camelCase files with named exports.
- Imports use the `@/` alias, which points at the app's own root.
- Coerce and whitelist every external input in the route handler before it reaches a query. There is no schema library; do not add one without asking.
- Route handlers in web return through `json()` from `lib/models.ts` and export `OPTIONS`. Keep the response shape the clients already expect.
- Name things by what they do: `sendInvoiceEmail`, not `handleEmail2`.
- Comments are in English and explain why, usually the limit or incident behind the code. Delete commented-out code.
- Every data-driven view handles loading, empty, and error states.
- UI copy is English in web, landing and the extensions; Hungarian first in tokenleads. Plain, short, no exclamation marks.
- Match the surrounding style: single quotes, semicolons, two spaces. There is no formatter; do not hand-reformat untouched lines.
- Tests cover pure logic. tokenleads uses Vitest; web uses `node:test`.

## 05 Security and best practices

- Secrets live in environment variables and are read on the server only.
  Never log them, never send them to the client. Never read `.env*` files other than `.env.example`.
- Every new API path is protected by the middleware by default. Opening one needs explicit approval.
- Escape everything scraped or user-supplied before it reaches an HTML string: `esc()` in the extensions and in `MapModal.tsx`.
- Never trust a client-supplied user id, price or token amount (tokenleads).
- No new auth flow, payment path, or data deletion behavior without explicit approval.
- Read docs/SECURITY.md before changing auth, the open routes, data handling, secrets or deletion. Where it is stricter than this section, it wins.

## 06 Useful commands

There is no root package.json. `<app>` is `web`, `landing` or `tokenleads`.

```
npm --prefix apps/<app> install          install dependencies
npm --prefix apps/<app> run dev          dev server (web 3000, tokenleads 3010, landing 3020)
npm --prefix apps/<app> run build        production build (must pass before a deploy)
npm --prefix apps/<app> run typecheck    type check
npm --prefix apps/tokenleads run test    unit tests (Vitest)
node --test apps/web/lib/organize.test.mjs   the web unit test
```

- `lint`: the script exists but `next lint` was removed in Next.js 16 and there is no ESLint config. Do not run it. (planned, T-007)
- `format`, `test:e2e`: do not exist. (planned)
- Extensions: no commands. Load `apps/extension` or `apps/extension-reviews` unpacked in `chrome://extensions` and reload after a change.
- `apps/landing` and `apps/tokenleads` may have no `node_modules`; ask before running `npm install`.

If a command fails, report the exact output. Do not work around it silently.

## 07 Definition of done

A task is done when all of these are true:
- The change does what the task asked, and nothing else.
- `typecheck` passes for every Next.js app you touched, and `build` passes when a route, page or config changed. tokenleads tests pass if you touched tokenleads.
- Extension changes: say which page or flow the user must reload and check by hand. You cannot run the extension.
- New UI uses the app's tokens and class conventions. landing and tokenleads work at 375px.
- Docs are updated if a structure, a decision, a model or a token changed.
- README.md and the app's own README are updated in the same change whenever it makes them stale (apps, stack, commands, setup, endpoints, structure). Do this without asking.
- The summary says what changed, what was not done, and what the user should check.

## 08 When to stop and ask

Stop and ask instead of guessing when:
- The task conflicts with the PRD, the design system, or ARCHITECTURE.md §05, §06 or §08.
- Two reasonable readings of the task lead to different work.
- The change needs a new dependency, collection, field, secret, or service.
- Something is broken that the task did not mention.

Ask with the specific question, the options you see, and your recommendation.

## 09 Git workflow

- Work on `main`. There are no feature branches and no pull requests in this project.
- Commit only when the user asks. Stage only the files of the task; the working tree often holds the user's unrelated work in progress.
- Commit subject: one English sentence saying what the change does, as in the existing history ("Gzip the extension sync uploads"). No `fix` or `wip` throwaways.
- One logical change per commit. Never commit secrets, .env files or build output.
- Do not push, force-push or rebase. The user pushes.
- The user deploys. Do not run `vercel deploy` after a change; only when the user explicitly asks for a deploy.
