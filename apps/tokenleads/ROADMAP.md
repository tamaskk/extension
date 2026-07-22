# TokenLeads — Fejlesztési Roadmap és Feature-javaslatok

> Állapot: 2026-07-08 · Az app működő MVP (auth, token-gazdaság, kereső facetekkel,
> feloldás, költési előzmények, admin). Ez a dokumentum a következő lépéseket
> rangsorolja: mit kell megerősíteni, és mitől lesz belőle igazi termék.

---

## 0. Jelenlegi állapot (mi van kész)

| Terület | Állapot |
|---|---|
| Auth (register/login, JWT cookie, bcrypt) | ✅ kész |
| Token-mag: atomi levonás, append-only ledger, idempotencia | ✅ kész |
| Unlock-jogosultságok (lead/kontakt, örök, dupla fizetés kizárva) | ✅ kész |
| Kereső: 8 szűrő, facet-aggregáció 1.1M leadből, 24h search grant | ✅ kész |
| Költési előzmények (cursor-lapozás, típus-szűrő) | ✅ kész |
| Mock token-vásárlás (3 csomag) | ✅ kész (fizetés NINCS bekötve) |
| Admin: árazás élőben, user-lista, kézi korrekció, statok | ✅ kész |
| UI: Panze-stílusú világos dashboard, SVG ikonok, reszponzív | ✅ kész |
| Tesztek | ❌ nincs (csak kézi smoke) |
| E-mail (verifikáció, értesítések) | ❌ nincs |
| Rate limiting / abuse-védelem | ❌ nincs |
| Monitoring / hibakövetés | ❌ nincs |

---

## 1. KRITIKUS — élesítés előtt kötelező (P1)

### 1.1 Bónusz-farmolás elleni védelem
**Probléma:** e-mail-verifikáció nélkül eldobható címekkel végtelen 25 tokenes fiók
nyitható → az egész adatbázis ingyen lehalászható.
**Megoldás:**
- E-mail verifikáció (Resend/Postmark, magic link) — bónusz csak verifikált címre.
- Regisztrációs rate limit IP-re (pl. 3 fiók / IP / nap).
- Eldobható domain-lista blokkolás (mailinator, temp-mail stb. — npm `disposable-email-domains`).
**Effort:** M · **Hatás:** kritikus bevétel-védelem

### 1.2 Rate limiting minden fizetős végpontra
**Probléma:** 1 tokenért oldalanként scripttel lehalászható a teljes DB; a facets
és search végpontok DoS-olhatók.
**Megoldás:**
- In-memory / Upstash Redis token-bucket: search max 30/perc, unlock max 60/perc, auth max 10/perc.
- Napi keresési kvóta (pl. 200 oldal/nap/user), admin által állítható a settings collectionben.
- 429 válasz egységes `{error:'rate_limited', retryAfter}` formában, UI-ban visszaszámláló.
**Effort:** M · **Hatás:** kritikus

### 1.3 Stripe integráció (a mock lecserélése)
**Probléma:** bevétel jelenleg nulla — a vásárlás mock.
**Megoldás:**
- Stripe Checkout Session (legegyszerűbb): POST `/api/wallet/purchase` → checkout URL.
- Webhook `/api/webhooks/stripe`: `checkout.session.completed` → credit() a meglévő
  idempotencia-kulccsal (`purchase:<sessionId>`) — a token-mag már felkészült rá.
- `purchases.providerRef` unique index = webhook-replay védelem (kész a séma).
- Számlázás: Stripe Tax + invoice, EU ÁFA kezelés.
**Effort:** M · **Hatás:** bevétel bekapcsolása

### 1.4 Reconciliation job (ledger ↔ wallet egyezőség)
**Probléma:** ha a folyamat a wallet-levonás és a ledger-insert között hal meg,
az egyenleg és a ledger széttart — most senki nem venné észre.
**Megoldás:**
- Napi cron (Vercel Cron vagy node-cron): minden walletre `balance ==
  SUM(ledger.amount)` ellenőrzés; eltérés → admin alert + auto-fix opció.
- Eredmény a settings/`lastReconciliation` kulcsba + admin dashboardra.
**Effort:** S · **Hatás:** pénzügyi integritás

### 1.5 Hibakövetés + strukturált logok
**Probléma:** production hibát most csak a user panaszából látnánk.
**Megoldás:**
- Sentry (@sentry/nextjs) — API route-ok + kliens hibák.
- Spend/credit műveletek strukturált logja (userId, type, amount, txId) —
  vitás esetben visszakereshető.
**Effort:** S · **Hatás:** üzemeltethetőség

### 1.6 Automata refund-szabály rossz adatra
**Probléma:** kontakt-feloldás után kiderülhet: üres/halott elérhetőség → bizalomvesztés.
**Megoldás:**
- Feloldáskor szerveroldali check: ha MINDHÁROM kontaktmező üres → 0 token, "nincs
  elérhetőség" jelzés (feloldás ingyen, a UI előre mutatja).
- "Hibás adat jelentése" gomb → admin queue → egy kattintásos refund (a `refund`
  tx-típus már létezik a sémában).
**Effort:** S-M · **Hatás:** bizalom + churn csökkentés

---

## 2. NÖVEKEDÉSI FEATURE-ÖK (P2)

### 2.1 Mentett keresések + e-mail alert ("lead radar") ⭐ legnagyobb érték
- Szűrő-kombináció elmentése egy kattintással (a `queryKey` már kanonikus — kész az alap).
- Napi/heti cron: új leadek a mentett szűrőre → e-mail "12 új villanyszerelő Houstonban".
- Ez hozza vissza a usereket = ismétlődő token-költés. Előfizetési upsell alapja.
- **Effort:** M

### 2.2 CSV/Excel export tokenért
- Feloldott leadek exportja ingyen; maszkolt találati lista exportja tokenért
  (pl. 20 sor = 5 token, kontakt nélkül).
- A web appban már van `xlsx` minta ([apps/web](../web/package.json)) — átemelhető.
- **Effort:** S

### 2.3 Csomag-feloldás (bulk unlock) kedvezménnyel
- "Mind a 20 feloldása ezen az oldalon" — pl. 20×2 helyett 32 token (20% kedvezmény).
- Egy tranzakció, egy ledger-sor, unlock-ok batch-insertje — a token-mag változatlan.
- **Effort:** S-M

### 2.4 Előfizetéses csomagok (havi token-keret)
- Pro: $29/hó → 400 token/hó + mentett keresés limit ↑; Business: $99/hó → 1600 token.
- Stripe Billing subscription + havi cron credit. Bónusz: elsőbbségi support.
- Pay-as-you-go marad belépőnek.
- **Effort:** M-L (Stripe 1.3 után)

### 2.5 Mini-CRM a feloldott leadekre
- Jegyzet, státusz (felhívva / ajánlat / nyert / vesztett), címkék a saját leadeken.
- Saját `leadnotes` collection a leadtokens DB-ben — a forrás-DB érintetlen.
- A GridLeads webben már van salesStatus-minta — koncepció átemelhető.
- Ettől lesz "ragadós" a termék: az adat + munkafolyamat is nálunk él.
- **Effort:** M

### 2.6 AI outreach-generátor tokenért ⭐ magas árrés
- A forrás-leadekben már OTT VAN az aiSummary/aiPainPoints/aiPitch — most csak mutatjuk.
- Új művelet: "Személyre szabott e-mail írása" (8 token) — Claude API hívás a lead
  adataiból + a user cégprofiljából → kész outreach draft.
- Token-áras AI = a legjobb árrésű termék a rendszerben.
- **Effort:** M

### 2.7 Referral program
- "Hozz egy barátot: mindketten +15 token" — verifikált regisztráció után jóváírás.
- `referrals` collection + egyedi kód a useren; a credit() idempotencia véd a dupla jóváírástól.
- **Effort:** S-M

### 2.8 API-hozzáférés fejlesztőknek (API kulcs)
- `tl_live_...` kulcsok, ugyanaz a token-gazdaság géppel hívva (search/unlock JSON).
- Magasabb csomagokhoz. A middleware-be egy `Authorization: Bearer` ág.
- **Effort:** M

---

## 3. UX-POLISH / DELIGHT (P3, egyenként <1 nap)

1. **Alacsony egyenleg figyelmeztetés** — 5 token alatt sárga sáv + gyors feltöltés gomb; 402-nél azonnali vásárlás-modal (most redirect van).
2. **Onboarding tour** — első belépéskor 3 lépéses walkthrough + "első keresésed ingyen" kupon.
3. **Nemrég megtekintett leadek** — localStorage, dashboard widget.
4. **Hasonló leadek** — lead-részleteknél "még 5 villanyszerelő Houstonban" (ugyanaz a query, ingyen teaser, feloldás tokenért).
5. **Billentyűparancsok** — `/` fókusz a keresőre, `←/→` lapozás.
6. **Dark mode** — CSS változók már készen állnak rá, toggle a topbarba.
7. **Promo kódok** — admin által generált kód → token jóváírás (marketing kampányokhoz).
8. **i18n (EN)** — a magyar UI most hard-coded; export előtt string-fájlba szervezés.
9. **PWA** — manifest + ikon, mobilról "app-szerű" használat.

---

## 4. TOKEN-GAZDASÁG FINOMÍTÁS

| Ötlet | Miért |
|---|---|
| Bónusz-token lejárat (30 nap) | sürgeti az aktiválást, a vásárolt token nem jár le |
| Külön bónusz/vásárolt pool, bónusz fogy előbb | számviteli tisztaság (kötelezettség-kezelés) |
| Dinamikus árazás kategóriánként | HOT lead vagy NO_WEBSITE lead drágább lehet (kereslet-alapú) |
| Wallet "hold" mechanizmus | bulk műveletnél előfoglalás → siker után véglegesítés |
| Árváltozás-védelem | a UI mindig a válaszban kapott árat mutassa, ne a cache-elt pricing-et |

---

## 5. ARCHITEKTÚRA / ÜZEMELTETÉS

```
  MOST                          6 HÓNAP MÚLVA
  ┌──────────────┐              ┌──────────────┐    ┌─────────────┐
  │ Next.js app  │              │ Next.js app  │───▶│ Stripe      │
  │  (minden)    │              │              │───▶│ Resend      │
  └──────┬───────┘              └──────┬───────┘    │ Sentry      │
         │                             │            │ Upstash     │
  ┌──────▼───────┐              ┌──────▼───────┐    └─────────────┘
  │ Atlas        │              │ Atlas        │    ┌─────────────┐
  │ leadtokens + │              │ leadtokens + │◀───│ Cron worker │
  │ myapp (RO)   │              │ myapp (RO)   │    │ reconcile + │
  └──────────────┘              └──────────────┘    │ lead radar  │
                                                    └─────────────┘
```

- **Indexek a forrás-DB-re:** a kereső szűrői (category, rating, reviewCount,
  leadTemperature, websiteStatus) compound indexet igényelnek a `myapp.leads`-en,
  különben 10x usernél lassul. Egyeztetendő: ki birtokolja a "idegen" DB indexeit.
- **Facets materializálás:** 10 perces in-memory cache helyett napi cron írja egy
  `facets` dokumentumba — több szerver-instance esetén is konzisztens, első hívás
  sem lassú.
- **Séma-drift védelem:** Zod-validáció a forrás-lead olvasásánál — ha a GridLeads
  pipeline mezőt nevez át, hangos hiba, nem csendes adat-szivárgás.
- **Tesztek:** a token-mag ([lib/tokens.ts](lib/tokens.ts)) unit tesztje az első —
  konkurens spend, idempotencia-ütközés, negatív egyenleg tiltás. Vitest + mongodb-memory-server.

---

## 6. ISMERT HIBAMÓDOK (regisztry)

| Kódút | Hibamód | Kezelt? | Teendő |
|---|---|---|---|
| spend() | wallet-levonás után process-halál, ledger-sor nélkül | ❌ | 1.4 reconciliation |
| search | facets aggregáció timeout hideg cache-nél (~10s) | ⚠️ részben | 5. materializálás |
| unlock | forrás-lead törlődik feloldás után | ⚠️ ledger őrzi a nevet | unlock-kor snapshot mentése a leadtokens-be |
| purchase (mock) | dupla POST → két purchase doc | ✅ credit idempotens | Stripe-nál sessionId lesz a kulcs |
| register | párhuzamos azonos e-mail | ✅ unique index + 409 | — |
| login | brute force | ❌ | 1.2 rate limit |
| facets/search | injection a query paramokban | ✅ regex-escape + enum whitelist | — |
| bármely API | Atlas kapcsolat-hiba | ⚠️ 500 | Sentry + retry a dbConnect-ben |

---

## 7. JAVASOLT SORREND (ütemterv)

| # | Mit | Prioritás | Effort | Függőség |
|---|---|---|---|---|
| 1 | E-mail verifikáció + anti-farming (1.1) | P1 | M | Resend fiók |
| 2 | Rate limiting + napi kvóta (1.2) | P1 | M | — |
| 3 | Stripe Checkout + webhook (1.3) | P1 | M | Stripe fiók |
| 4 | Sentry + reconciliation cron (1.4, 1.5) | P1 | S | — |
| 5 | Refund-szabály + jelentés gomb (1.6) | P1 | S | — |
| 6 | Token-mag unit tesztek (5.) | P1 | S | — |
| 7 | Mentett keresés + lead radar (2.1) | P2 | M | 1-es (e-mail) |
| 8 | Bulk unlock + CSV export (2.2, 2.3) | P2 | S-M | — |
| 9 | AI outreach-generátor (2.6) | P2 | M | Claude API kulcs |
| 10 | Mini-CRM (2.5) | P2 | M | — |
| 11 | Előfizetések (2.4) | P2 | L | 3-as (Stripe) |
| 12 | Referral + promo kódok (2.7, 3.7) | P3 | S-M | 1-es |
| 13 | Delight-csomag (3.1–3.6) | P3 | S/darab | — |
| 14 | API kulcsok (2.8) | P3 | M | 2-es (rate limit) |

**Első sprint javaslat (1 hét):** #1–#6 — utána az app biztonságosan élesíthető
és pénzt tud beszedni. A #7 (lead radar) az első igazi retention-feature — az legyen
a második sprint gerince.

---

## 8. 12 hónapos célkép

Önkiszolgáló lead-piactér: a user regisztrál, radar-riasztásokat kap a saját
szűrőire, AI-val írt outreach-csel indít kampányt, mini-CRM-ben követi a pipeline-t,
havi előfizetésben veszi a tokent — a GridLeads scraper pedig folyamatosan tölti
alá a friss készletet. A token-gazdaság minden új képesség (AI, export, API)
monetizációs rétege marad: egy mag, sok termék.
