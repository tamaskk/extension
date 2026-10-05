---
description: Review the current changes against this project's rules (PRD scope, DESIGN_SYSTEM tokens, ARCHITECTURE boundaries, AGENTS.md definition of done) with the project subagents. Read-only.
argument-hint: "[commit-range or path]"
allowed-tools:
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git branch *)
---

# Review changes

## Context
- Branch: !`git branch --show-current`
- Working tree: !`git status --short`
- Changed files vs HEAD: !`git diff --stat HEAD`
- Recent commits: !`git log --oneline -10`

## Scope
Review `$ARGUMENTS` if given (a range such as `abc123..HEAD`, or a path such as `apps/web`). Otherwise review the uncommitted changes, including untracked files. Work happens on `main` in this project, so there is no base branch to compare against.

## Steps
1. Get the full diff for the scope. Group the changed files by app (web, extension, extension-reviews, landing, tokenleads) and by area: UI, API routes, models, config, tests, docs.
2. Delegate in parallel:
   - `code-reviewer`: the scope and the changed files.
   - `security-auditor`: only if the diff touches login, cookies, `middleware.ts`, `OPEN_API`, CORS, tokenleads tokens or Stripe, external input reaching a query, `innerHTML`, secrets or data deletion.
   - `design-reviewer`: only if `.tsx` or `.css` files changed.
3. While they run, check the project contract yourself:
   - PRD §07: nothing out of scope was built.
   - ARCHITECTURE §05: no forbidden imports (components → db, models or auth; one app importing another; secrets in client code). Grep the changed files.
   - ARCHITECTURE §06: no "fix" of an intentional decision.
   - ARCHITECTURE §08: no new collection, field, dependency, env variable or open route without approval.
   - Duplicated logic: if scoring, the website status list, `SYNC_BASE` or the dark tokens changed, all copies changed.
   - DESIGN_SYSTEM: no new raw hex in changed UI; loading, empty and error states exist.
   - AGENTS.md §07: typecheck passes for touched apps; README and docs updated if they became stale.
4. Merge and deduplicate the findings. Output:
   - Verdict: **Ready to commit** or **Changes required**.
   - Table: `Severity (Blocker / Major / Minor / Nit) | File:line | Finding | Suggested fix`.
   - "Checked, no issues": one line per area.
   - Extension changes: the manual checks the user must do in Chrome.
5. Do not edit files. Offer to fix the Blockers and Majors.

Deeper passes: bundled `/code-review` (correctness bugs; effort levels; `--fix`), `/security-review`, bundled `/simplify` (cleanup).
