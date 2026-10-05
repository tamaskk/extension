---
description: Fix a GitHub issue by number, a task from docs/TASKS.md, or a described bug, end to end. Reproduce, make the smallest fix, verify, summarize.
argument-hint: "<issue-number, T-### or bug description>"
allowed-tools:
  - Bash(gh issue view *)
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(git log *)
---

# Fix issue: $ARGUMENTS

1. **Understand.** If the argument is an issue number, run `gh issue view $ARGUMENTS --comments`. If it is a `T-###` id, read it in docs/TASKS.md. If `gh` is unavailable, ask me to paste the issue. Restate expected vs actual behaviour and how to reproduce it.
2. **Locate.** Find the code path and the app it lives in; use the Explore subagent for broad searches. Read the PRD feature it belongs to and the ARCHITECTURE sections it touches (§05, §06).
3. **Plan.** List the files you expect to change. More than five, or anything in docs/ARCHITECTURE.md §08 (new dependency, collection, field, open route, auth or sync-format change): stop and ask, with options and a recommendation.
4. **Working tree.** Stay on `main`. Run `git status --short`; the uncommitted files there are usually my own work. Do not stash, reset or stage them.
5. **Reproduce first.** If the bug is in pure logic (scoring, organize, token maths, masking), write a failing test: Vitest in tokenleads, `node:test` next to the module in web. Run it and confirm it fails for the reason from step 1. For route, UI and extension bugs there is no test harness: state the exact reproduction steps instead. Never reproduce by writing to the database.
6. **Fix.** The smallest change that fixes it, following AGENTS.md and the rules. No drive-by refactors. If the logic has copies (see AGENTS.md §03), fix every copy.
7. **Verify.** Run the new test if any, `npm --prefix apps/<app> run typecheck` for each touched app, and `build` if a route, page or config changed. For extension changes, list what I must reload and check in Chrome.
8. **Report.** Root cause in one or two sentences, the fix, the tests added, what you did not do, what I should check. Tick the box in docs/TASKS.md if it was a task. Suggest a commit subject in the project's style (one English sentence). Do not commit, push or deploy unless I ask.
