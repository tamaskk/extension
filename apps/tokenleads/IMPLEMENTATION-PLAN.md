# TokenLeads — Teljes Roadmap Implementációs Terv

> A ROADMAP.md #1–14 tétele + az 5. szekció architektúra-tételei (indexek, facets
> materializálás, séma-validáció, unlock-snapshot). Egy menetben épül, függőségi
> sorrendben. Külső szolgáltatás-kulcs nélkül is minden flow működik dev-fallbackkel.

## Vezérelvek

1. **Provider-opcionális adapterek.** Resend/Stripe/Sentry/Anthropic kulcs env-ből;
   ha hiányzik → explicit dev-mód (e-mail az `outbox` collectionbe + admin felületen
   olvasható; Stripe helyett azonnali mock ugyanazon a purchase-állapotgépen; AI
   helyett jelölt sablon-generátor; Sentry helyett strukturált console log).
2. **A token-mag nem változik.** Minden új pénzmozgás a meglévő `spend()/credit()`
   idempotencia-kulcsos úton megy — új tx-típusokkal.
3. **Zero új runtime dependency.** Stripe/Resend/Anthropic REST-en, `fetch`-csel.
   Dev-dep: vitest + mongodb-memory-server (tesztek).
4. **Edge middleware nem ér DB-t** — API-kulcsos auth a route-rétegben
   (`requireSessionOrKey`), a middleware csak átengedi a Bearer `tl_` kéréseket.

## Adatmodell-bővítés (leadtokens DB)

| Collection | Új/változás | Mezők |
|---|---|---|
| users | bővül | verifyToken, verifyTokenExp, emailVerifiedAt (aktív), referralCode (unique sparse), referredBy, referralRewardedAt, onboardedAt |
| wallets | változatlan | — |
| tokentransactions | enum bővül | +`spend_bulk_unlock`, `spend_export`, `spend_ai`, `referral_bonus`, `promo_credit`, `subscription_grant` |
| unlocks | bővül | `snapshot` (lead-adat feloldáskor — forrás-törlés ellen) |
| savedsearches | ÚJ | userId, name, filters, queryKey, alert(off/daily/weekly), lastMaxId, lastRunAt, lastCount |
| leadmeta | ÚJ (mini-CRM) | userId+leadId unique, note, status(new/called/offer/won/lost), tags[] |
| reports | ÚJ | userId, leadId, reason, status(pending/refunded/rejected), refundTxId, resolvedBy/At |
| promocodes | ÚJ | code unique, tokens, maxUses, usedCount, expiresAt |
| promoredemptions | ÚJ | code+userId unique |
| apikeys | ÚJ | userId, name, prefix, keyHash(sha256), lastUsedAt, revokedAt |
| subscriptions | ÚJ | userId, plan, status, provider(mock/stripe), providerRef, currentPeriodEnd |
| outbox | ÚJ | to, subject, html, status(sent/dev/failed), provider, createdAt |
| usagecounters | ÚJ | key (pl. `search:<uid>` / `reg:<ip>`), day, n — napi kvóták |
| facetscache | ÚJ | singleton: value, updatedAt — materializált facets |
| reconciliations | ÚJ | ranAt, checked, mismatches[], fixed |

## Árazás-kulcsok (settings, admin által állítható)

SIGNUP_BONUS=25 (⚠️ mostantól VERIFIKÁCIÓKOR jár), SEARCH_COST=1, LEAD_UNLOCK_COST=2,
CONTACT_UNLOCK_COST=5, +ÚJ: BULK_DISCOUNT_PCT=20, EXPORT_PAGE_COST=5, AI_EMAIL_COST=8,
REFERRAL_BONUS=15, DAILY_SEARCH_QUOTA=200, LOW_BALANCE_THRESHOLD=5.
Előfizetések (pricingShared.PLANS): pro $29/hó→400 token, business $99/hó→1600 token.

## Fázisok és fájlok

### F1 — Alap: modellek, árazás, közös libek
- `lib/models.ts` — új collectionök + enum bővítés + indexek
- `lib/pricingShared.ts` / `lib/pricing.ts` — új kulcsok, PLANS
- `lib/txShared.ts` — TYPE_LABEL egy helyen (DRY: wallet+dashboard most duplikálja)
- `lib/rateLimit.ts` — in-memory sliding window + napi kvóta (usagecounters)
- `lib/monitoring.ts` — strukturált log + Sentry envelope (DSN esetén), captureError
- `lib/mailer.ts` — Resend REST vagy outbox-dev-mód; sablonok (verify, radar)
- `lib/cronAuth.ts` — CRON_SECRET ellenőrzés
- `lib/csv.ts` — CSV builder (escape, BOM Excelhez)
- `lib/apiUtil.ts` — clientIp(), requireVerified(), requireSessionOrKey()

### F2 — Auth-rework: verifikáció + anti-farming + referral
- register: eldobható-domain blokk, IP-kvóta (3/nap), verifyToken generálás,
  referralCode, ?ref= mentés; bónusz NEM itt jár
- `GET /api/auth/verify?token=` — emailVerifiedAt + bónusz credit (`signup:<uid>`)
  + referral jutalom mindkét félnek (`referral:<uid>:referrer|referee`)
- `POST /api/auth/resend` — új token + mail (rate limited)
- login változatlan; `GET /api/auth/me` += verified, onboarded
- `POST /api/auth/onboarded` — tour befejezve
- middleware: +OPEN: verify, resend, webhook, cron; Bearer `tl_` átengedés
- Költő végpontok kapuja: verifikálatlan → 403 `email_not_verified`

### F3 — Fizetés: Stripe + előfizetés + promo
- purchase rework: Stripe Checkout Session (REST) ha van kulcs, különben mock —
  egységes pending→completed állapotgép
- `POST /api/webhooks/stripe` — HMAC-SHA256 aláírás-ellenőrzés kézzel (t,v1),
  checkout.session.completed → credit (idempotens `purchase:<id>`)
- `POST/GET/DELETE /api/subscription` — mock: azonnali aktiválás + havi grant;
  cron hosszabbít; Stripe-ready (mode=subscription)
- `POST /api/wallet/promo` — kód beváltás (unique redemption, credit `promo:*`)
- admin: promo CRUD

### F4 — Lead-funkciók
- unlock/contact: snapshot mentés; kontakt-feloldás ha MINDEN kontaktmező üres →
  0 token + `noContact` jelzés
- `POST /api/leads/bulk-unlock` {ids≤20} — kedvezményes egy-tranzakciós feloldás
- `GET /api/leads/export?scope=unlocked` (ingyen, teljes) +
  `POST /api/leads/export` {filters,page} (EXPORT_PAGE_COST, grant-hez kötve, maszkolt)
- `GET /api/leads/[id]/similar` — 5 hasonló (kategória+város), ingyen teaser, maszkolt
- `POST /api/leads/[id]/report` + admin queue + egy-kattintásos refund
- `GET/PUT /api/leads/[id]/meta` — mini-CRM (jegyzet/státusz/címkék)
- `POST /api/leads/[id]/ai-email` — Claude API (REST) vagy sablon-fallback;
  AI_EMAIL_COST; aidrafts mentés
- mentett keresések CRUD `/api/searches` + leads oldali UI
- forrás-olvasás validátor (séma-drift → hangos log, szanitizált érték)
- getSourceLead fallback unlock-snapshotból (törölt forrás-lead ellen)

### F5 — Cron + üzemeltetés
- `/api/cron/reconcile` — ledger↔wallet egyezés, eltérés-lista + opcionális fix
- `/api/cron/radar` — mentett keresések alertjei (lastMaxId-alapú "új lead" számolás)
- `/api/cron/facets` — facets materializálás a facetscache-be
- `/api/cron/subscriptions` — mock-előfizetés hosszabbítás + havi token grant
- `vercel.json` cron ütemezés; mind CRON_SECRET-tel védve
- `scripts/source-indexes.mjs` — indexek a myapp.leads-re (leadScore sort,
  category/websiteStatus/temperature compound) — FUTTATVA
- admin felület: reports queue, promos, outbox (dev-levelek), reconciliation státusz

### F6 — API kulcsok
- `/api/keys` CRUD — `tl_live_<hex>` egyszer mutatva, sha256 hash tárolva
- requireSessionOrKey: cookie → különben Bearer hash-lookup; lastUsedAt
- Settings oldalon kezelés + curl példa

### F7 — UI/UX csomag
- PurchaseModal: 402 → globális modal (redirect helyett), csomagok + vásárlás
- Low-balance: topbar chip borostyán < küszöb + dashboard sáv
- Verify-banner: verifikálatlan user minden oldalon látja + újraküldés gomb
- Onboarding tour (3 lépés, első belépéskor)
- Nemrég megtekintett (localStorage) — dashboard widget
- Hasonló leadek a részletoldalon; billentyűk: `/` fókusz, ←/→ lapozás
- Dark mode: data-theme + CSS vars + toggle (localStorage + prefers-color-scheme)
- PWA: manifest + ikonok + meta
- i18n: `lib/i18n.ts` (hu/en szótár) — chrome/nav/auth/gombok lefordítva, toggle a
  Settingsben; hosszú leíró szövegek maradnak hu (dokumentált részleges scope)
- Új oldal: `/settings` (profil, nyelv, referral link, API kulcsok)
- Wallet: promo-kód mező + előfizetés-kártyák; leads: mentett keresések, export,
  bulk unlock, save-search; unlocked: CRM oszlop + export; lead detail: AI e-mail,
  similar, CRM szerkesztő, report gomb

### F8 — Tesztek + verifikáció
- vitest + mongodb-memory-server: token-mag (konkurens spend, idempotencia,
  negatív egyenleg tiltás, credit/refund), buildQuery whitelist, queryKey
  stabilitás, CSV escape, rateLimit ablak
- `npm run build` + teljes curl-smoke minden új flow-ra + screenshot-ellenőrzés
- Multi-agent adversarial code review (Workflow) a teljes diffre → megerősített
  hibák javítása

## Env (új .env kulcsok)

```
APP_URL=http://localhost:3010
CRON_SECRET=<generált>
EMAIL_FROM=TokenLeads <no-reply@tokenleads.dev>
# opcionális, kulcs nélkül dev-fallback:
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SENTRY_DSN=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

## Kockázatok / döntések

- **Bónusz áthelyezése verifikációra** — meglévő dev-userek érintetlenek (bónuszuk
  már jóváírva, idempotencia véd).
- **In-memory rate limit** — egy-instance deploynál korrekt; multi-instance → Upstash
  csere egyetlen modulban (dokumentálva).
- **Forrás-DB indexek** — Atlas online build, 1.1M dokumentum, alacsony kockázat;
  script külön futtatható/visszavonható (dropIndex).
- **i18n részleges** — teljes string-extrakció külön menet; infra + fő felület kész.
