@AGENTS.md

<!--
Maintainer notes (block comments are stripped from Claude's context):
- AGENTS.md is the tool-agnostic rulebook. Only Claude Code-specific guidance lives here.
- Keep this file under 120 lines. Procedures go to .claude/skills, file-type rules to .claude/rules with `paths`.
-->

# Claude Code guide: GridLeads

## Snapshot
- GridLeads: Google Maps lead scraping, scoring and outreach for one operator. Stage: live, internal tool.
- Monorepo without a workspace: `apps/web` (dashboard), `apps/extension` and `apps/extension-reviews` (MV3, plain JS), `apps/landing`, `apps/tokenleads` (separate product).
- Stack: Next.js 16 App Router · React 19 · TypeScript strict · global CSS with variables · MongoDB/Mongoose · Vercel CLI.
- The truth lives in docs/: PRD (what and why), DESIGN_SYSTEM (how it looks), ARCHITECTURE (where code goes). Read them as AGENTS.md §02 says; do not restate them here.

## Commands
`npm --prefix apps/<app> run dev` · `npm --prefix apps/<app> run typecheck` · `npm --prefix apps/<app> run build` · `npm --prefix apps/tokenleads run test` · `node --test apps/web/lib/organize.test.mjs`

## Harness map: use these instead of improvising
| When | Use |
| --- | --- |
| After a feature, before a commit | `/review-changes` (project rules + subagents) |
| Hunting correctness bugs in a diff | bundled `/code-review`; security pass: `/security-review` |
| Fixing a bug or an issue | `/fix-issue <number or description>` |
| Deploying | the user deploys. `/deploy <app> <preview or production>` exists for when I ask |
| Independent review | subagents `code-reviewer`, `security-auditor`, `design-reviewer` |
| Broad code search | built-in `Explore` subagent (keeps your context clean) |
| UI work | the `ui-component` skill loads for UI files |
| Building a PRD feature or a TASKS.md item | the `new-feature` skill |
| Library docs (Next.js 16, Mongoose 9) | the `context7` MCP server |
| Checking the dashboard or an extension page in a browser | the `claude-in-chrome` tools, when connected |

## Working agreements (Claude Code)
- Plan first (plan mode or a written plan) when a task touches more than 5 files or anything in docs/ARCHITECTURE.md §08.
- Track multi-step work in the task list, one item in progress at a time.
- Verify before saying done: `npm --prefix apps/<app> run typecheck` for each app you touched, and the relevant tests. Say what you ran.
- Hooks in .claude/hooks enforce safety. If one blocks you, do not work around it: say what you wanted to run and why.
- Only change .claude/**, .mcp.json or CLAUDE.md when the task is about the harness itself.
- A convention I correct twice belongs in AGENTS.md or .claude/rules, not only in auto memory: propose the edit.

## Gotchas
- The working tree usually holds my uncommitted work. Never `git add -A` or `git add .`; stage named files.
- Local dev servers talk to the production database (docs/ARCHITECTURE.md §09).
- `npm run lint` is broken in every app (`next lint` was removed in Next.js 16). Do not run it or report it as a failure.
- `apps/landing` and `apps/tokenleads` may have no `node_modules`; the Stop hook skips their typecheck in that case.
- `validate-bash.sh` denies `git push` while on `main`. That is expected: I push myself.
