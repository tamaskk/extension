# Deploy configuration

Read by the deploy skill. Values only, never secrets. Any value still in [brackets]: the skill stops and asks.

| Key | Value |
| --- | --- |
| Platform | Vercel |
| Deploy method | CLI from the app folder. No Git integration, no CI. |
| Who deploys production | The user. Claude prepares, and deploys only through `/deploy` with an explicit "yes". |
| Rollback | `vercel rollback` from the app folder, or Vercel dashboard → Deployments → previous deployment → Promote |

## web

| Key | Value |
| --- | --- |
| Folder | `apps/web` |
| Vercel project | `gridleads` |
| Production URL | https://gridleads-wheat.vercel.app |
| Smoke checks | `curl -s -o /dev/null -w "%{http_code}" https://gridleads-wheat.vercel.app/login` returns 200; `curl -s -o /dev/null -w "%{http_code}" https://gridleads-wheat.vercel.app/api/leads` returns 401 (login gate works); `curl -s https://gridleads-wheat.vercel.app/api/missing-states` returns JSON |
| Required env vars (names) | `MONGODB_URI`, `EMAIL`, `PASSWORD`, `AUTH_SECRET`, `OPENAI`, `RESEND_API_KEY`, `OUTREACH_FROM`, `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, set in Vercel, never here |
| Note | Both extensions call this URL. A breaking change to `/api/sync`, `/api/reviews` or `/api/audit` breaks installed extensions at once. |

## tokenleads

| Key | Value |
| --- | --- |
| Folder | `apps/tokenleads` |
| Vercel project | [project name] |
| Production URL | [https://...] |
| Smoke checks | `curl -s -o /dev/null -w "%{http_code}" <url>/login` returns 200; `curl -s <url>/api/pricing` returns JSON |
| Required env vars (names) | `MONGODB_URI`, `AUTH_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, set in Vercel, never here |
| Note | `vercel.json` defines four daily crons. |

## landing

| Key | Value |
| --- | --- |
| Folder | `apps/landing` |
| Vercel project | [project name] |
| Production URL | [https://...] |
| Smoke checks | `curl -s -o /dev/null -w "%{http_code}" <url>/` returns 200; `curl -s <url>/api/stats` returns JSON |
| Required env vars (names) | `MONGODB_URI`, `NEXT_PUBLIC_CRM_URL`, set in Vercel, never here |
