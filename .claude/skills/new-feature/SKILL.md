---
name: new-feature
description: Implement a feature from docs/PRD.md or a task from docs/TASKS.md end to end - plan, thin vertical slices, verification, definition of done, task list and README update. Use when the user asks to build a feature or task listed there.
argument-hint: "<feature or task id, e.g. F6 or T-004, or a name>"
---

# New feature: $ARGUMENTS

1. Find the feature in PRD §05 or the task in docs/TASKS.md. Restate the user action, the "done when" and the out-of-scope neighbours (§07). Not in either file: stop and ask whether to add it there first.
2. Decide which apps it touches. Read docs/ARCHITECTURE.md (§03 where code goes, §05 boundaries, §06 intentional decisions, §08 stop list), and docs/DESIGN_SYSTEM.md for UI. Extension work: the `extension` rule applies.
3. Plan in plan mode, or present a plan: vertical slices (model or helper → route + `lib/api.ts` wrapper → component and CSS; extension side if any), files per slice, how each slice is verified, risks. More than five files in a slice, or anything in ARCHITECTURE §08: ask. Wait for approval.
4. Stay on `main`. Do not touch or stage my unrelated uncommitted files.
5. Per slice: implement; write a test first where the logic is pure (Vitest in tokenleads, `node:test` in web); run `npm --prefix apps/<app> run typecheck`.
6. Never exercise a write path against the database to "try it". Local dev uses production data. Describe the manual check for me instead.
7. Finish: every "done when" is observable; loading, empty and error states exist; copies of duplicated logic are in sync; TASKS.md box ticked; ARCHITECTURE, DESIGN_SYSTEM and the READMEs updated if they became stale.
8. Suggest `/review-changes` before the commit. Do not commit or deploy unless I ask.
