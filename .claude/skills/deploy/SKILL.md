---
name: deploy
description: Deploy one of the Next.js apps to a Vercel preview or to production with the project's release checklist. Use only when the user explicitly asks to deploy.
argument-hint: "<web|landing|tokenleads> <preview or production>"
disable-model-invocation: true
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(npm --prefix apps/* run typecheck)
  - Bash(npm --prefix apps/* run build)
  - Bash(npm --prefix apps/tokenleads run test)
---

# Deploy: $ARGUMENTS

The user normally deploys by hand. This skill runs only when they invoke it.

Read `${CLAUDE_SKILL_DIR}/deploy-config.md` first: projects, URLs, smoke checks, rollback. If a value needed for the chosen app is still a bracketed placeholder, stop and ask.

## 1. Preconditions (stop on any failure)
- The first argument is `web`, `landing` or `tokenleads`; the second is `preview` or `production`. Anything else: ask.
- The Vercel CLI uploads the working directory, not a commit. Run `git status --short` and list every uncommitted file under `apps/<app>`. If there are any, say that they will be deployed and wait for my "yes".
- `apps/<app>/node_modules` exists. If not, stop and ask before installing.
- The extensions are not deployed. They are loaded unpacked.

## 2. Quality gate
Run, for the chosen app: `npm --prefix apps/<app> run typecheck`, then `npm --prefix apps/<app> run build`, and for tokenleads also `npm --prefix apps/tokenleads run test`. Do not run `lint` (broken, see AGENTS.md §06). Any failure: stop, report, do not deploy.

## 3. Deploy
- From the app folder: preview `vercel deploy`; production `vercel deploy --prod -y`.
- Production always needs my explicit "yes" in this conversation, even though the hook asks too.
- Never change environment variables, domains or project settings as part of a deploy.
- Do not `git push`.

## 4. Verify
- Wait for the deployment URL. For production, confirm the output says the alias was assigned.
- Run the smoke checks from the config.
- Report: app, target, URL, the commit SHA of HEAD and whether uncommitted files were included, checks and their results.

## 5. If something is wrong
Report first. Offer the rollback steps from the config; run them only after I say so.
