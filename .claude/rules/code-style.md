# Code style

- TypeScript strict in `apps/web`, `apps/landing`, `apps/tokenleads`. Do not add new `any` (use `unknown` and narrow); existing `any` in route handlers is known debt. No `@ts-ignore` or `@ts-expect-error` without a comment explaining why.
- File names follow the folder: React components are PascalCase `.tsx` in the app's flat `components/`; `lib/` files are camelCase `.ts`; route folders are lowercase kebab with `route.ts`; extension files are camelCase `.js`.
- Components are `export default function Name`. Everything in `lib/` is a named export.
- Imports use the `@/` alias, which is the app's own root. Never import across `apps/*`.
- One function, one job. Name it by what it does (`sendInvoiceEmail`, not `handleEmail2`).
- Do not add new empty `catch` blocks. Catch only where you can handle the error or add context.
- Modules that read `process.env` secrets or import `lib/db.ts` / `lib/models.ts` are server code: never import them from a component or from `lib/api.ts`.
- Comments are English and explain why, usually the limit or incident behind the code. No commented-out code. No TODO without a T-### id from docs/TASKS.md.
- There is no formatter and no linter. Match the file: single quotes, semicolons, two spaces. Do not reformat lines you are not changing.
