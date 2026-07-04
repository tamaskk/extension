# GridLeads extension — hiba- és teljesítmény-audit

> **Dátum:** 2026-07-04 · **Vizsgált kód:** `apps/extension` (fő scraper, multi-window engine v2) és `apps/extension-reviews` (review scraper), ~3 500 sor.
> **Módszer:** 6 párhuzamos, dimenziónkénti audit (bugok / konkurencia / sebesség / energia) + adverzáriális verifikáció findingonként. Jelölés:
> ✅ = független verifikáló agent megerősítette · 🔎 = kézi kód-ellenőrzéssel megerősítve (a verify-fázis egy része session-limitbe futott) · ⚠️ = bizonytalan elem, mérés/teszt kell hozzá.

---

## TL;DR

- **2 kritikus hiba:** (1) a lead-tároló (`gridleads_projects`) írása nincs zárolva — 5 párhuzamos ablaknál rendszeresen **csendben elvesznek lead-ek**; (2) a popup batch-mezői **ugyanabba a storage kulcsba írnak, mint a batch engine állapota** — gépelés a popupban futó run közben **törli az egész futást**.
- **Sebesség:** a SCRAPE-SPEEDUP.md quick-win #1 (időzítések) **nincs implementálva** — a konstansok az eredetiek. Csak konstans-hangolással **2,2–2,5×**, a direkt pb-fetch lapozással **5–15×** gyorsulás érhető el.
- **Energia:** a fő fogyasztók: (a) capture-önként **3 teljes store-szerializáció** a service workerben, (b) 5–9 **teljesen renderelő Maps ablak** (WebGL, csempék, fotók), amit a scraper soha nem olvas, (c) a dashboard **minden storage-írásra teljes újratöltést + újra-renderelést** csinál. Együtt −40–60% CPU és több száz MB RAM spórolható több ablaknál.

---

## 1. Hibák súlyosság szerint

### 🔴 KRITIKUS

#### K1. Lock nélküli read-modify-write a lead-tárolón → lead-vesztés párhuzamos scrape alatt ✅
**Hely:** [background.js:38-53](apps/extension/background/background.js#L38-L53) (`addRecords`), kiváltó: [background.js:80-90](apps/extension/background/background.js#L80-L90) (`webRequest.onCompleted` → `captureSearch`).

A `lockBatch` mutex **csak** a batch-állapotot (`BKEY`) védi. Az `addRecords` a teljes `gridleads_projects` objektumot olvassa (`await getProjects()`), módosítja, majd visszaírja (`await setProjects(p)`) — a két `await` között bármely másik capture befuthat. 5 ablaknál (DEFAULT_CONCURRENCY=5) a `/search` RPC-k másodpercenként érkeznek; két átfedő `addRecords` ugyanazt a pillanatképet olvassa, és a második írás **felülírja az első ~20 lead-jét**. A `sessionFound` és a konzol már beszámolta őket — a veszteség láthatatlan. Ugyanez a lock nélküli minta él az `ensureProject`, `deleteLocalProjects`, `deleteFolder`, `moveProjects`, `deleteRecord(s)`, `setChecked`, `importJson`, `deleteProject` útvonalakon is.

**Fix:** a `lockBatch`-csel azonos mutex a PKEY-re, minden `getProjects→setProjects` szekvenciára:
```js
let _projLock = Promise.resolve();
function lockProjects(fn) { const p = _projLock.then(() => fn()); _projLock = p.then(() => {}, () => {}); return p; }
// pl.: async function addRecords(query, records) { return lockProjects(async () => { ...meglévő törzs... }); }
```
Hosszabb távon: projektenkénti storage-kulcs (lásd E1) — az ütközés strukturálisan megszűnik, és a teljesítmény-probléma is (lásd lent).

#### K2. A popup batch-mezői felülírják a batch engine állapotát — gépelés törli a futó runt 🔎
**Hely:** [popup.js:182](apps/extension/popup/popup.js#L182) vs. [background.js:121](apps/extension/background/background.js#L121).

```js
// popup.js:182 — MINDEN input eseményre fut:
const saveBatch = () => chrome.storage.local.set({ gridleads_batch: { p: ..., m: ..., s: ... } });
// background.js:121 — ugyanez a kulcs az engine állapota:
const BKEY = 'gridleads_batch';
```
A `getBatch()` ([background.js:214](apps/extension/background/background.js#L214)) a `{p,m,s}` alakot érvénytelennek látja (`b.v !== ENGINE_V`), **törli a kulcsot és `null`-t ad vissza** → az aktív run (queue + workerek) megsemmisül, a worker-ablakok gazdátlanul nyitva maradnak, a sorba állított (még el nem indított) queue is elvész. A dashboard már javított változatot használ (`gridleads_batch_fields`, [dashboard.js:702](apps/extension/dashboard/dashboard.js#L702)) — a popup nem.

**Fix (egysoros):** popupban kulcs-átnevezés a dashboarddal azonosra:
```js
const saveBatch = () => chrome.storage.local.set({ gridleads_batch_fields: { p: ..., m: ..., s: ... } });
chrome.storage.local.get('gridleads_batch_fields', (o) => { const b = o.gridleads_batch_fields; ... });
```

### 🟠 MAGAS

#### M1. Böngésző-újraindítás / halott worker-tab után a run örökre beragad 🔎
**Hely:** [background.js:550-562](apps/extension/background/background.js#L550-L562) (`batchWatchdog`), [background.js:480](apps/extension/background/background.js#L480); reviews: [background.js:199-210](apps/extension-reviews/background/background.js#L199-L210) (`renavWorker`).

Crash/újraindítás után a storage-ban `active:true` + workerek halott `tabId`-kkel. A watchdog `navigating >45s` esetén újra-drive-ol: a `tabs.update` a halott tabon hibát dob (lenyelve), a stage friss `ts`-sel újra `navigating` → **45 másodpercenként végtelen ciklus**, a worker sosem lesz `done`. A `topUpWorkers` a stale workereket élőnek számolja (`live >= want`) → új ablak sem nyílik. A `startQueue` „already running"-ot ad vissza — csak a Stop segít. (Az adopt-mód indítása ellenőrzi a tab-életet — [background.js:390-394](apps/extension/background/background.js#L390-L394) —, az auto mód és a watchdog nem.) A reviews extension `renavWorker`-e ugyanígy pörög halott tabon, és a business `inflight` claimje is bent ragad.

**Fix:** a watchdogban tab-életellenőrzés; halott tab → `onWorkerTabClosed(w.tabId)` (batch requeue + worker done), majd `topUpWorkers()` pótolja az ablakot:
```js
for (const w of b.workers) {
  if (w.stage === 'done') continue;
  if (!(await isLiveTab(w.tabId))) { await onWorkerTabClosed(w.tabId); continue; }
  ...meglévő age-alapú ágak...
}
```

#### M2. Stream mód: a késői capture versenyez a sync+delete-tel → az utolsó oldal(ak) lead-jei a DB-ből kimaradnak vagy zombi-projekt marad 🔎
**Hely:** [background.js:513-515](apps/extension/background/background.js#L513-L515) (`advanceWorker` → `streamSyncItem`), [background.js:173-178](apps/extension/background/background.js#L173-L178).

A `scrapeDone` után csak `DONE_SETTLE` (1,2 s) várakozás van, de a `captureSearch` saját, teljes hálózati re-fetch-e ennél tovább tarthat. Ha az utolsó oldal `addRecords`-a a `syncProjectsToDb` **után**, de a `deleteLocalProjects` **előtt** fut le → a lead-ek lokálisan törlődnek, a DB-be sosem kerülnek be. Ha a delete **után** → a projekt pár rekorddal „feltámad" lokálisan, és többé nem szinkronizálódik.

**Fix:** query-nkénti in-flight számláló a capture köré (`pending[q]++` fetch előtt, `--` az `addRecords` után); a `streamSyncItem` várjon, amíg `pending[q] === 0` (rövid poll, max ~10 s), csak utána sync+delete.

#### M3. Consent/interstitial oldalt a fő extension nem kezel → EU-s gépen a batch nem halad, 45 s-enként újranavigál 🔎
**Hely:** [background.js:485-498](apps/extension/background/background.js#L485-L498) (`onBatchTabComplete`).

A handler csak `/maps/search` URL-re enged tovább. Ha a Google consent-oldalt ad (friss profil, EU), a worker `navigating`-ben marad, a watchdog 45 s-enként **ugyanarra az elemre** navigál újra → végtelen ciklus, nulla haladás, miközben az ablakok fogyasztanak. A reviews extensionben van consent-kezelés (`consent.js` + [background.js:269](apps/extension-reviews/background/background.js#L269)); a fő extensionben semmi.

**Fix:** a reviews-mintát átvenni: `consent.google.com` content script + a `tabs.onUpdated`-ben consent-URL esetén nem újranavigálni, hanem várni a consent utáni `complete`-re; N sikertelen kör után az item hibával jelölése (ne csendes végtelen ciklus legyen).

#### M4. Reviews: determinisztikus mentési hiba → ugyanaz a business végtelen ciklusban 🔎
**Hely:** [background.js:253-257](apps/extension-reviews/background/background.js#L253-L257) (`onReviewsScraped`).

Ha a `postReviews` tartósan hibázik (pl. 413 — túl nagy payload, vagy szerver-oldali validációs hiba), a claim felszabadul, a business a DB-ben nem lesz done → a `fetchNext` **ugyanazt adja vissza**, a worker újra végigcsinálja a ~25 s-es scrape-et, újra hibázik — örökké. A `done` számláló közben hamisan nő.

**Fix:** SW-memóriás hibaszámláló dedupKey-enként; N (pl. 3) hiba után a kulcs kerüljön permanensen az `exclude` listára a run végéig, és `errors`-ként jelenjen meg.

### 🟡 KÖZEPES

| # | Hely | Hiba | Fix | Ell. |
|---|------|------|-----|------|
| C1 | [content.js:154](apps/extension/content/content.js#L154) | A per-tab **Stop gomb batch alatt nem állít le**: a loop minden kilépéskor `scrapeDone`-t küld → a worker 1,2 s múlva a **következő keresésre lép**, a megszakított keresés „done"-ként rögzül (stream módban a részleges adat DB-be megy és lokálisan törlődik). A batch-szintű Stop (`batchStopAll`) működik. | `stopped` flag a stop-handlerben; `if (!stopped) safeSend({type:'scrapeDone'})`. | ✅ |
| C2 | [content.js:10](apps/extension/content/content.js#L10) | **Nincs dupla-injektálás elleni guard** (a reviews content.js-ben van: `__glrReviewsLoaded`). A manifest-injektálás + `startContent` `executeScript`-je két példányt futtat → két scroll-loop, dupla CPU, dupla `scrapeDone` (ez utóbbit a stage-guard többnyire elnyeli). | Első sorba: `if (window.__glLoaded) return; window.__glLoaded = true;` | 🔎 |
| C3 | [background.js:101](apps/extension/background/background.js#L101), [background.js:466](apps/extension/background/background.js#L466) | **Lead-attribúció törékeny**: a `tabQuery` csak memóriában él (SW-restart után üres), és a worker továbblépésekor a régi keresés késői capture-jei már az **új query alá** kerülnek; SW-restart után a „Google Maps leads" gyűjtőbe esnek, amit stream mód sosem szinkronizál. | Attribúció elsődlegesen a capture URL-jéből (`parseQ`), a `tabQuery` csak fallback; `onBatchTabComplete` ellenőrizze, hogy a betöltött URL a várt query-t tartalmazza-e. ⚠️ ellenőrizendő, hogy a `/search?pb=` URL-ben mindig van-e `q=` param. | 🔎⚠️ |
| C4 | [background.js:497](apps/extension/background/background.js#L497), [background.js:557](apps/extension/background/background.js#L557) | `startContent` hibája (6 sikertelen próba) után nincs kezelés: a worker `scraping`-ben ül, a watchdog **240 s után csendben átugorja az itemet** — a keresés 0 leaddel „done". Sorozatos hibánál egy egész város esik ki, keresésenként 4 perc alatt. | `startContent` `false` visszatérésekor azonnali retry-számláló + item hibajelölés; ne a 4 perces watchdog legyen az egyetlen út. | 🔎 |
| C5 | [background.js:424](apps/extension/background/background.js#L424) | **Adopt mód:** worker-ablak bezárásakor a batch visszakerül `pending`-be, de ha a többi worker már `done` (nekik nem jutott munka), **senki sem veszi fel** — a `rescanAdopt` a `done` workerek tabjait nem adoptálja újra (`have` set), a watchdog `done`-t nem drive-ol. Run örökre aktív, batch örökre pending. | Watchdogban: ha van `pending` batch és egy `done` worker tabja él, állítsd `init`-re és drive-old újra. | 🔎 |
| C6 | [background.js:330](apps/extension/background/background.js#L330) | **Extension-update futó run alatt:** a Chrome az alarmokat update/reload-kor törli, és semmi nem élesíti újra → az aktív batch watchdog nélkül fagy. | `onInstalled`/`onStartup` listener: ha `getBatch()` aktív, `chrome.alarms.create(HB_ALARM, ...)` + watchdog-futtatás. Ugyanez a reviews extensionben. ⚠️ az alarm-törlés pontos feltételei Chrome-verziófüggők. | 🔎⚠️ |
| C7 | [background.js:216-227](apps/extension-reviews/background/background.js#L216-L227) | **Reviews:** `releaseAndAdvance`-ben nincs stage/identitás-guard → a 240 s-es watchdog-timeout és egy késői `reviewsScraped` **dupla release**-t csinál: a worker ÚJ claimjét szabadítja fel, `done` duplán számolódik, a tab navigáció közben eltéríthető. | A hívó adja át a várt `dedupKey`-t; a lockon belül csak akkor release, ha `w.current?.dedupKey === expected && w.stage === 'scraping'`. | 🔎 |
| C8 | [background.js:166-185](apps/extension-reviews/background/background.js#L166-L185) | **Reviews:** `driveWorker`-ben nincs stage-guard → dupla drive (watchdog + normál advance) a `w.current`-et felülírja, az előző claim **örökre az `inflight`-ban ragad** → azt a businesst a run végéig senki sem scrape-eli. A lockon belüli lassú `fetchNext` (lásd E5) kifejezetten megnöveli ennek az ablakát. | A lockolt szakasz elején: `if (w.stage !== 'init' && w.stage !== 'retry') return { stop: true };` | 🔎 |
| C9 | [content.js:109](apps/extension-reviews/content/content.js#L109) | **Reviews:** a review-kártya a „See more" kattintás után **60 ms-cel** parse-olódik és soha többé → hosszú review-k és tulajdonosi válaszok **csonkán** mentődnek (a `seen.set` az első verziót rögzíti, a záró `harvest` a már látott ID-ket kihagyja). | A záró passzban újra-parse-olni a látott kártyákat is (`seen.set(id, parseReview(card))` felülírással), + expand után ~300 ms várakozás. | 🔎 |
| C10 | [content.js:126](apps/extension-reviews/content/content.js#L126) | **Reviews:** ha a Reviews-fül nem nyílik meg és nincs kártya a DOM-ban, az eredmény **sikeres üres** (`{reviews: []}`) → a business véglegesen done 0 review-val. Google DOM-változásnál az egész flotta csendben 0-kat ment. | Ha a businessnek a DB szerint `reviewCount > 0` és 0 review jött, `error`-ral menteni (retry-olható), ne sikerként. | 🔎 |
| C11 | [content.js:139-154](apps/extension-reviews/content/content.js#L139-L154) | **Reviews:** worst-case scrape-idő (140 loop × ~1,1–1,4 s + fix várakozások ≈ 160–220 s) **súrolja a 240 s-es watchdog-timeoutot** — lassú gépen/hálón a sok review-s businessek „scrape timeout"-tal, 0 review-val záródnak véglegesen. | Watchdog-timeout 240→360 s, vagy a content küldjön időközi „progress" pinget, ami a `w.ts`-t frissíti. ⚠️ a tényleges worst-case idő méréssel igazolandó. | 🔎⚠️ |
| C12 | [dashboard.js:395-396](apps/extension/dashboard/dashboard.js#L395-L396) | `websiteStatus`, `rating`, `reviewCount`, `leadTemperature`, `opportunityScore` **escape nélkül** kerülnek a tábla `innerHTML`-jébe (a `statusChip` a nyers `s`-t írja ki ismeretlen státusznál) → importált/szinkronizált JSON-ból HTML/attribútum-injektálás az extension-oldalon. | Minden interpolált mezőre `esc()`; számmezőkre `Number()` koerció. | ✅ |
| C13 | [dashboard.js:502-507](apps/extension/dashboard/dashboard.js#L502-L507) | A dashboard **CSV-exportja a szűrők többségét ignorálja**: friss `getRecords`-ot kér, és csak a `nowebsite` szűrőt alkalmazza — a hot/email/has-website szűrő és a keresőmező **nem** érvényesül, a user mást kap, mint amit lát. | A már kiszámolt `view`-t (szűrt+rendezett) exportálni: `downloadBlob(buildCsv(sortRows(rows.filter(matches))), ...)`. | ✅ |
| C14 | [mapsParser.js:153-158](apps/extension/lib/mapsParser.js#L153-L158) | **Csendes zero-parse:** Google formátumváltásnál a parser `[]`-t ad, a diagnosztika csak egy globálisban landol — a user annyit lát, hogy üresek a projektek. | Zero-parse számláló a SW-ben; N egymást követő 0-parse után badge/notification („Maps formátum változott?"). | ✅ |

### 🟢 ALACSONY

| # | Hely | Hiba | Fix | Ell. |
|---|------|------|-----|------|
| L1 | [dashboard.js:5](apps/extension/dashboard/dashboard.js#L5) | A dashboard `NO_SITE` halmaza nem tartalmazza a `DOMAIN_PARKED`/`UNDER_CONSTRUCTION` státuszt (a scoring `WEBSITELESS`-e igen) → ezek a lead-ek kiesnek a „No website" szűrőből/számlálóból. | Közös konstans a `lib/scoring.js`-ből. | ✅ |
| L2 | [dashboard.js:330](apps/extension/dashboard/dashboard.js#L330) | CSV formula-injection: scrape-elt név/cím `=`/`+`/`-`/`@` kezdettel képletként fut Excelben. | Export előtt prefix `'` a veszélyes kezdőkarakterekre. | ✅ |
| L3 | [dashboard.js:382](apps/extension/dashboard/dashboard.js#L382) | `website`/`mapsUrl` sémavizsgálat nélkül megy `href`-be (`javascript:`/`data:` nem tiltott). | Csak `http(s):` engedése. | ✅ |
| L4 | [mapsParser.js:60](apps/extension/lib/mapsParser.js#L60) | `placeId` (`[78]`) nincs típusellenőrizve (a `cid` igen) → nem-string érték mérgezi a `dedupKey`-t és a `mapsUrl`-t. | `typeof === 'string'` guard, mint a cid-nél. | ✅ |
| L5 | [scoring.js:21-22](apps/extension/lib/scoring.js#L21-L22) | `host.endsWith('facebook.com')` a `myfacebook.com`-ra is igaz (`fb.com`/`instagram.com` dettó). | `host === d \|\| host.endsWith('.' + d)`. | 🔎 |
| L6 | [background.js:314-315](apps/extension/background/background.js#L314-L315) | `startQueue` already-running ellenőrzése a lockon kívül (TOCTOU): dupla Start-klikk `workers=[]`-re resetel, nyitott ablakok gazdátlanná válnak. | Az ellenőrzést a `lockBatch`-en belülre vinni. | 🔎 |
| L7 | [background.js:526-531](apps/extension/background/background.js#L526-L531) | `finishBatch`/`stopAllBatches` `setBatch(null)`-ja lockon kívül — párhuzamos `enqueueBatch`-et törölhet. | `lockBatch`-be csomagolni. | 🔎 |
| L8 | [background.js:556](apps/extension/background/background.js#L556) | Watchdog 45 s-es re-drive lassú, de élő navigációt is újraindít → item duplán scrape-elve (önjavító, csak idő-pazarlás). | Re-drive előtt `tabs.get` + URL-összevetés. | 🔎 |
| L9 | [background.js:349-357](apps/extension/background/background.js#L349-L357) | Adopt: a fókuszált tab kizárása pillanatkép — ha a user a 300 ms-os staggerelt adoptálás közben ablakot vált, a nézett tabot is elnavigálhatja. | Adoptálás előtt közvetlen újra-ellenőrzés tabonként. | 🔎 |
| L10 | [background.js:49](apps/extension-reviews/background/background.js#L49) | Vesszős fallback-`dedupKey` (`"Smith, Jones & Co\|…"`) szétesik a vesszővel joinolt `exclude` paraméterben → két worker ugyanazt a businesst claimelheti. | `exclude` JSON-ként vagy `encodeURIComponent`-elt elemekkel; szerveroldali parse igazítás. | 🔎 |
| L11 | [background.js:284-294](apps/extension-reviews/background/background.js#L284-L294) | Reviews endgame: `noMore` után az utolsó aktív worker ablakának bezárásakor az `onRemoved` nem ellenőrzi az `allDone`-t → a run örökre `active` marad. | Az `onRemoved` lock-szakaszában allDone-számítás → `finishRun()`. | 🔎 |
| L12 | [content.js:128](apps/extension-reviews/content/content.js#L128) | `sortNewest` hibája néma → „legrelevánsabb" sorrendű review-k mentődnek „100 legújabb"-ként, jelzés nélkül. | A visszatérési értéket az eredménybe tenni (`sortApplied: false`). | 🔎 |
| L13 | [popup.js:44](apps/extension-reviews/popup/popup.js#L44) | Generikus hibánál a popup „✓ Claimed 0 window(s) — scraping…" sikert mutat. | `res.ok === false` ág külön kezelése. | 🔎 |
| L14 | [popup.js:116-133](apps/extension/popup/popup.js#L116-L133) | Az 1 s-es poll versenyez a Start-klikkel: in-flight poll visszaengedélyezheti a Start gombot indítás közben. | Poll-eredmény eldobása, ha közben user-akció történt (generation counter). | 🔎 |
| L15 | [content.js:157-163](apps/extension/content/content.js#L157-L163) | Stop→Start gyors egymásutánja két párhuzamos scroll-loopot indít (egy `running` flagen osztoznak) — dupla CPU, dupla `scrapeDone`. | Loop-generation token: a loop csak a saját generációja alatt fut. | 🔎 |
| L16 | [dashboard.js:373](apps/extension/dashboard/dashboard.js#L373) + [popup.js:128](apps/extension/popup/popup.js#L128) | Üres-állapot a szűretlen `total`-hoz kötve; a popup progress-bar a lead-számot százalékként kezeli (100 lead = 100%). | Kozmetika; `view.length` használata, ill. bar-cap felirattal. | ✅ |

---

## 2. Sebesség — mérhető javaslatokkal

**Jelenlegi keresésenkénti költségvetés** (a kódbeli konstansokból, ~120 találatos keresésre): navigáció ~3 s + `NAV_SETTLE` 2,2 s + content-handshake 0–1,2 s + ~8–20 scroll-lépés × átl. 1,95 s + end-confirm **3 × ~5,3 s ≈ 19,8 s** + `DONE_SETTLE` 1,2 s ≈ **43–60 s**, amiből ~40+ s fix várakozás. A SCRAPE-SPEEDUP.md quick-win #1 időzítés-csökkentései **nincsenek implementálva** (a konstansok mellett a kommentek is „(original)"-t mondanak); a #2 (több ablak) és a stream-to-DB implementálva van. ✅

| # | Javaslat | Hely | Várható gyorsulás | Ell. |
|---|----------|------|-------------------|------|
| S1 | **Direkt pb-fetch lapozás** (a doksi fő refaktora): az első `/search?pb=` URL elkapása után az offset-token léptetésével (`!8i0→!8i20→…`) SW-ből fetchelni, render és scroll nélkül; Promise-pool 3–6 query-re; a scroll marad fallbacknek. A `captureSearch` már ma is pontosan így fetchel+parse-ol — a mechanizmus bizonyítottan működik. | [background.js:92-96](apps/extension/background/background.js#L92-L96) | **~46 s → ~3 s/keresés (~15×/worker)** pb-sablonnal; ha query-nként egy navigáció kell az első URL-hez: ~7–9 s (~5–8×). Rendszerszinten **5–15×**, és megszűnik az ablakszám-plafon. ⚠️ a pontos lapozó-token (`!8i` vs. folytatási token) egy valós elkapott URL-en igazolandó; a Google-oldali rate-limit küszöb méretlen — jitter + 429-backoff kell. | ✅⚠️ |
| S2 | **End-confirm zsugorítása:** `NEED_END` 3→1 (a `scrollHeight`-növekedés guard megvéd), confirm-sleepek 2600/500/2200 → 800/300/800 ms. | [content.js:114](apps/extension/content/content.js#L114), [content.js:130-137](apps/extension/content/content.js#L130-L137) | **−17,9 s/keresés** (19,8 s → ~1,9 s a farokrészen) ≈ **+64% áteresztés** önmagában. ⚠️ ritka esetben az utolsó, lassan streamelő oldal levághat — a growth-guard mérsékli. | ✅ |
| S3 | **Scroll fix sleep → növekedés-polling:** `sleep(1600+rand·700)` helyett 150 ms-os poll a `feed.scrollHeight`-ra, 2,5 s cap; stagnálási ütem 2500+n·800 → 1200+n·400, kilépés 8→5 kör (worst case 48,8 s → ~10 s). | [content.js:121](apps/extension/content/content.js#L121), [content.js:142-146](apps/extension/content/content.js#L142-L146) | **−6–10 s/keresés (+15–28%)**. ⚠️ a Google eredmény-érkezési latenciája (400–900 ms) becslés. | ✅ |
| S4 | **Settle-k csökkentése:** `NAV_SETTLE` 2200→300 ms (a content `waitForFeed`-je már 400 ms-onként pollozva megvárja a feedet — a settle duplikáció), `DONE_SETTLE` 1200→400 ms, injection-retry 1200→500 ms. | [background.js:206-207](apps/extension/background/background.js#L206-L207), [background.js:237](apps/extension/background/background.js#L237) | **−2,7 s/keresés (~6%)**; 500 keresésn