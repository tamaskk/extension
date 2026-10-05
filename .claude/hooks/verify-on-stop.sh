#!/usr/bin/env bash
# .claude/hooks/verify-on-stop.sh   (OPTIONAL)
# Stop hook. When Claude finishes a turn with uncommitted TypeScript changes,
# run `npm run typecheck` in every Next.js app that has such changes; if one
# fails, block the stop and hand Claude the errors so it fixes them in the
# same turn. Loop guard: if Claude is already continuing because of a Stop
# hook (stop_hook_active), let it stop.
# Monorepo without a root package.json: each app under apps/ is checked on
# its own, and an app without installed dependencies is skipped.
set -u
command -v node >/dev/null 2>&1 || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0

IFS= read -r -d '' ACTIVE_JS <<'JS' || true
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.parse(raw).stop_hook_active ? "true" : "false"); }
  catch { process.stdout.write("false"); }
});
JS

IFS= read -r -d '' BLOCK_JS <<'JS' || true
let out = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (out += d));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: "npm run typecheck failed after your changes. Fix these errors before finishing, or explain why they are expected:\n" + out.trim(),
  }));
});
JS

[ "$(node -e "$ACTIVE_JS")" = "true" ] && exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
changed="$(git status --porcelain --untracked-files=all 2>/dev/null | grep -E '\.(ts|tsx|mts|cts)$')"
[ -n "$changed" ] || exit 0

failed=""
for app in web landing tokenleads; do
  dir="apps/$app"
  printf '%s\n' "$changed" | grep -q " $dir/" || continue
  grep -q '"typecheck"' "$dir/package.json" 2>/dev/null || continue
  [ -x "$dir/node_modules/.bin/tsc" ] || continue
  if ! output="$(npm --prefix "$dir" run -s typecheck 2>&1)"; then
    failed="${failed}--- ${dir} ---
${output}
"
  fi
done

[ -n "$failed" ] || exit 0
printf '%s\n' "$failed" | head -n 60 | node -e "$BLOCK_JS"
exit 0
