# Teljesítmény fejlesztési terv: GridLeads dashboard

Technical audit és gap analysis az `apps/web` betöltési idejéről. Készült: 2026-10-05.

A terv a working tree akkori állapotára épül (benne a még nem commitolt `lib/projectScope.ts`, `lib/projectGeo.ts` és az email csempe változásai). A sorhivatkozások erre az állapotra vonatkoznak.

## Kiinduló állapot (baseline)

Minden szám mérés, nem becslés. Ahol becslés szerepel, ott ki van írva.

**Adatmennyiség** (production, `myapp` adatbázis):

| Collection | Dokumentum | Adat | Index |
| --- | --- | --- | --- |
| `leads` | 1 603 177 | 1 436 MB | 401 MB (24 index) |
| `reviews` | 549 729 | 340 MB | 44 MB |
| `projects` | 241 968 | 48 MB | 14 MB |
| `projectstats` | 159 681 | 32 MB | 10 MB |
| `activities` | 13 097 | 81 MB | 12 MB |
| `folders` | 774 | – | – |

A 241 968 projektből 82 287-nek nincs leadje, 8 470 nincs mappában, 241 513-nál a `name` megegyezik a `query`-vel. A 774 folderből 19 gyökér, a fa legfeljebb 2 szintű. Az adatbázis összesen 1 944 MB adat és 483 MB index az 5 GB-os Flex keretből.

**Infrastruktúra:** a Vercel function az `iad1` régióban fut (Washington DC, a válasz `x-vercel-id` fejléce `fra1::iad1::…`), az Atlas cluster Frankfurtban (`eu-central-1`) van. Csomag: Vercel Hobby, Atlas Flex.

**Dashboard megnyitása** (`https://gridleads-wheat.vercel.app/`, Chrome, Performance API):

| Fázis | Hideg (cache lejárt) | Meleg (304) |
| --- | --- | --- |
| HTML + JS betöltve | 1,4 s | 0,9 s |
| `GET /api/projects` | 8,2 s (TTFB 4,4 s + letöltés 3,7 s; 5,88 MB gzip, 65,6 MB JSON) | 1,8 s (300 byte) |
| `GET /api/folders` | 3,7 s | 1,3 s |
| Main thread blokkolva a hydrate után | kb. 11 s | 8,4 s (egyetlen long task) |
| `GET /api/leads` elindul | 20,7 s-nál | 11,2 s-nál |
| `GET /api/leads` válasz | +0,6 s | +0,5 s |
| `GET /api/categories` | +3,2 s | +6,0 s |
| `GET /api/leads?countChecked=1` | +2,5 s | +5,4 s |
| `GET /api/calls?count=1` | +3,5 s | +0,3 s |

Betöltés után a DOM 64 337 node, ebből 8 471 `.navitem`. Egy külön mérésnél, amikor a cache éppen újraépült, a `/api/projects` TTFB 14,0 s volt, a body letöltése 6,1 s.

**Többi nézet és szűrő** (production, egy-egy kérés):

| Kérés | Idő | Megjegyzés |
| --- | --- | --- |
| Leads, chip „Email found” | 16,9 s | 79 430 találat |
| Leads, Email: „website not checked yet” | 16,5 s | 944 728 találat |
| Leads, keresés „pizza” | 7,5 s | 8 207 találat |
| Leads, country = USA | 6,2 s | 1 556 774 találat |
| Leads, rendezés név szerint | 5,5 s | |
| Leads, Phone: none | 2,9 s | |
| Leads, gyökér folder (183 524 lead) | 2,0 s | categories ugyanitt 2,6 s |
| Leads, egy projekt (88 lead) | 0,4 s | |
| Stats, All leads, day | 11,4 s | levél folderre (17 481 lead) 6,7 s |
| Map, szűrő nélküli scope | 22,0 s | 200 000 pont, 71,8 MB JSON |
| Map, levél folder | 3,3 s | 17 481 pont, 6,1 MB |
| Reviews lista, 1. oldal | 5,4 s | |
| Reviews business autocomplete | 4,0 s | hideg function |
| Groups | 3,6 s | 5 csoport, hideg function |
| Changelog, 1. oldal | 0,6–1,7 s | |
| Categories summary | 1,1 s | 4 229 sor, a cache 2026-07-23-i |
| Notes, Calls | 0,3–0,5 s | |
| Duplicates | HTTP 500 | 1,3 s után, üres body |

**Közvetlen adatbázis mérés** (`explain('executionStats')`, a clustertől 21 ms pingre lévő gépről). Ez mutatja meg, mi lassú magában a MongoDB-ben, és mi csak a régió és a hideg indulás miatt:

| Lekérdezés | Exec idő | Terv |
| --- | --- | --- |
| Alap nézet: összes lead, `opportunityScore` szerint | 66 ms | `IXSCAN gl_opp_sort` |
| Rendezés `rating` / `scrapedAt` / `category` szerint, `_id` tie-breakkel | 2,8 / 4,8 / 5,7 s | `SORT ← COLLSCAN` |
| Ugyanez `_id` nélkül | 1 ms | `IXSCAN` |
| Rendezés `name` szerint | 19,0 s | `SORT ← COLLSCAN` |
| Chip „Email found”, sorok | 2,0 s | `SORT ← FETCH ← IXSCAN email_1`, 79 430 doc |
| Email „todo”, sorok / darabszám | 13,3 s / 3,5 s | 494 375 / 1 108 857 doc |
| Keresés `/pizza/i`, sorok / darabszám | 52 ms / 5,2 s | darabszám: `COLLSCAN` |
| `countDocuments({ checked: true })` | 1,6 s | `COLLSCAN` |
| `countDocuments({ call: true })` | 0 ms | `COUNT_SCAN call_1` |
| Gyökér folder (6 801 projekt), sorok / darabszám | 63 ms / 170 ms | |
| `$group` kategória szerint, összes lead | 2,3 s | covered index hinttel is 2,1 s |
| Stats napi bucketek / metrikák, összes lead | 3,4 s / 1,9 s | ugyanez `projectstats`-ból: 0,7 s |
| Reviews 1. oldal `scrapedAt` szerint | 4,2 s | `SORT ← COLLSCAN`, 549 729 doc |
| `projects` + `projectstats` teljes kiolvasása | 4,7 s + 3,5 s | a `/api/projects` rebuild forrása |
| `projectstats $lookup projects $group folderId` | 25,9 s | Mongo-n belüli join nem járható |

**Kliens oldali számítás** (Node benchmark, 245 966 projektnév): a `parseProjectGeo` minden projektre 2 877 ms, mert mind a 727 ismert régiónevet végigpróbálja. Ugyanez `Map` kereséssel 229 ms, azonos eredménnyel.

**Következtetés.** A 20–30 másodperc négy rétegből áll össze: (1) a function és az adatbázis két kontinensen van, és minden route külön hidegen indul; (2) a `/api/projects` payload 2 percenként lejár és teljes egészében újra letöltődik; (3) a böngésző 242 ezer projekten számol és 8 470 sort renderel egy lépésben; (4) a lead tábla lekérése csak mindezek után indul el, pedig nem függ tőlük.

## 1. Összesítő táblázat

Súly: 🔴 blokkoló · 🟠 komoly · 🟡 csiszolás. Méret: S ≤ 1 nap · M 2–5 nap · L 1+ hét.

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| | **A. Infrastruktúra** | | | | | |
| 1 | Function régió áthelyezése Frankfurtba | `apps/web/vercel.json` (új), Vercel Project Settings | A function `iad1`-ben fut, az Atlas Frankfurtban. Meleg kérés alapideje kb. 0,4 s, hideg route 3–3,7 s | Minden nézet minden kérését érinti; a legolcsóbb, legnagyobb hatású lépés | 🔴 | S |
| | **B. `/api/projects` payload és cache** | | | | | |
| 2 | Tartalom-alapú ETag és stale kiszolgálás háttér-rebuilddel | `app/api/projects/route.ts`, `lib/projectStats.ts`, `lib/cache.ts` (új) | Az ETag a rebuild időbélyege, a TTL 120 s: 2 percenként 5,88 MB újra letöltődik változatlan adatnál is, a kérés közben 4,4–14 s a rebuild | A megnyitás leglassabb hálózati lépése | 🔴 | S |
| 3 | Kompakt, oszlopos payload | `app/api/projects/route.ts`, `lib/projectsPayload.mjs` (új), `lib/api.ts` | 271 byte projektenként: ismétlődő kulcsok, duplikált `name`, 82 287 csupa nulla sor | Kisebb letöltés és parse minden tartalomváltozásnál | 🟠 | S |
| 4 | Kliens stale-while-revalidate a HTTP cache-ből | `lib/api.ts`, `lib/store.ts`, `app/api/folders/route.ts` | A sidebar meleg cache mellett is megvárja a hálózati revalidációt (1,3–1,8 s), addig skeleton | A sidebar azonnal megjelenik a legutóbbi állapottal | 🟠 | S |
| | **C. Dashboard első render** | | | | | |
| 5 | A lead tábla ne várjon a sidebarra | `components/Dashboard.tsx` | A `/api/leads` kérés csak `hydrated` után indul: 11,2–20,7 s-nál, miközben maga 0,5 s | Az első használható tartalom 10–20 s-mal korábban jelenik meg | 🔴 | S |
| 6 | `parseProjectGeo` gyorsítása | `lib/projectGeo.ts` | Projektenként 727 `endsWith`: 2,9 s a main threaden minden `summaries` változásnál | A 8,4 s-os long task harmada | 🔴 | S |
| 7 | „Ungrouped” csoport és sidebar windowing | `components/Dashboard.tsx`, `lib/windowing.mjs` (új), `app/globals.css` | 8 470 mappa nélküli projekt mind renderelve: 64 337 DOM node, minden állapotváltozásnál újrarenderelve | A long task maradéka, és a dashboard minden kattintása ettől akad | 🔴 | M |
| 8 | `tree` és `accurateMissing` memo szétbontása | `components/Dashboard.tsx` | Egy folder nyitása/zárása újracsoportosítja mind a 241 968 projektet és újraszámolja mind a 774 folder coverage badge-ét | A sidebar minden kattintása akad | 🟠 | S |
| 9 | `CategoryFilter` lusta betöltése | `components/CategoryFilter.tsx` | Megnyitáskor és minden scope váltáskor lefut egy `$group` az összes leaden (3,2–6,0 s), akkor is, ha a legördülőt senki nem nyitja ki | Felesleges terhelés a megosztott clusteren minden betöltésnél | 🟠 | S |
| | **D. Lead tábla lekérdezések** | | | | | |
| 10 | Rendezés index szerint (`_id` tie-break, `name` index) | `app/api/leads/route.ts`, `lib/models.ts` | Az `_id` tie-break miatt az `opportunityScore` és `leadScore` kivételével minden rendezés `COLLSCAN` + `SORT`: 2,8–19 s | Oszlopfejre kattintás ma másodpercekig tart | 🟠 | S |
| 11 | Sorok és darabszám szétválasztása | `app/api/leads/route.ts`, `lib/api.ts`, `components/Dashboard.tsx` | A sorok megvárják a `countDocuments`-et: keresésnél 52 ms helyett 5,2 s | Szűrés és keresés után a sorok azonnal megjelennek | 🟠 | S |
| 12 | Index deklarációk rendbetétele és `checked` index | `lib/models.ts`, `docs/ARCHITECTURE.md` | A `checked` számlálás `COLLSCAN` (1,6 s); az alap nézetet kiszolgáló `gl_opp_sort` index nincs a kódban | Minden betöltésnél lefut; új adatbázison az alap nézet is lassú lenne | 🟠 | S |
| 13 | Email szűrők indexelése | `app/api/leads/route.ts`, `app/api/projects/route.ts`, `lib/models.ts` | „Email found” 2,0 s exec (production: 16,9 s), „website not checked yet” 13,3 s | Az outreach munkafolyamat fő szűrői | 🟡 | S |
| 14 | Szó eleji keresés `searchTokens` mezővel | `lib/searchTokens.mjs` (új), `lib/models.ts`, `app/api/leads/route.ts`, `app/api/sync/route.ts`, `app/api/search-backfill/route.ts` (új) | A keresés 5 mezőn futó, horgonyzatlan regex: teljes scan, 5,2–7,5 s | A kereső a dashboard leggyakoribb művelete | 🟠 | M |
| | **E. Többi nézet** | | | | | |
| 15 | Stats nézet: metrikák `ProjectStat`-ból, bucket cache | `app/api/stats/route.ts`, `lib/cache.ts` | Két teljes `$group` az összes leaden: 11,4 s | A Stats nézet megnyitása ma 11 s | 🟠 | S |
| 16 | Map: karcsú pont payload és `applyProjectScope` | `app/api/geo/route.ts`, `components/MapModal.tsx`, `lib/api.ts`, `lib/models.ts` | 359 byte pontonként (200 000 pont = 71,8 MB, 22 s); a típus/régió szűrő regexet futtat az 1,6 M leaden | Széles scope-nál a Map használhatatlan | 🟠 | M |
| 17 | Reviews nézet: `scrapedAt` index és gyors számlálás | `app/api/reviews/list/route.ts`, `lib/models.ts`, `lib/projectScope.ts` | Az 1. oldal `SORT ← COLLSCAN` 549 729 dokumentumon: 4,2 s exec, 5,4 s production | A Reviews nézet megnyitása ma 5 s | 🟠 | S |
| 18 | Duplicates: darabolt, cache-elt újraírás | `app/api/duplicates/route.ts`, `components/DuplicatesModal.tsx`, `lib/api.ts`, `lib/models.ts` | Egyetlen `$group` az összes leaden túllépi a memória limitet: HTTP 500 | A funkció production-ön nem működik | 🟠 | M |
| | **F. Lazy sidebar (2. fázis)** | | | | | |
| 19 | Szerver: folder szintű összesítők, `GET /api/sidebar` | `app/api/sidebar/route.ts` (új), `lib/sidebar.ts` (új), `lib/projectStats.ts`, `lib/api.ts` | A sidebar számaihoz ma mind a 241 968 projektet le kell tölteni | A payload a projektszámmal lineárisan nő; ez szünteti meg | 🟠 | M |
| 20 | Szerver: projektek folderenként, projekt keresés, scope-olt csempék | `app/api/projects/route.ts`, `app/api/sidebar/stats/route.ts` (új), `lib/projectScope.ts`, `lib/api.ts` | Nincs endpoint egy folder projektjeire, a sidebar szűrőre és a szűrt csempékre | A 21. feladat előfeltétele | 🟠 | M |
| 21 | Kliens: store és Dashboard átállítása lazy betöltésre | `lib/store.ts`, `components/Dashboard.tsx`, `components/MapModal.tsx`, `components/DuplicatesModal.tsx` | A kliens minden projektet memóriában tart, és azon szűr, összegez | Ezzel a megnyitás ideje függetlenné válik a projektek számától | 🟠 | L |
| 22 | Coverage badge és folder info szerver oldali adatból | `lib/coverage.mjs` (új), `lib/sidebar.ts`, `components/Dashboard.tsx`, `components/FolderInfoModal.tsx` | A pontos „missing” badge a kliensen fut a teljes projektlistán, és induláskor 860 KB referencia adatot tölt be | A 21. feladat után a kliensnek nincs meg hozzá az adata | 🟡 | M |
| | **G. Mérés és dokumentáció** | | | | | |
| 23 | `Server-Timing` fejléc és a docs frissítése | `lib/models.ts`, `app/api/leads/route.ts`, `app/api/projects/route.ts`, `docs/ARCHITECTURE.md`, `README.md` | Nem látszik, hogy egy lassú kérésből mennyi az adatbázis és mennyi a hálózat; a docs a régi cache működést írja le | Az elfogadási feltételek ellenőrizhetők, a docs igaz marad | 🟡 | S |

## 2. Feladatok részletesen

### A. Infrastruktúra

#### 1. Function régió áthelyezése Frankfurtba

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Function régió áthelyezése Frankfurtba | `apps/web/vercel.json` (új), Vercel Project Settings | A function `iad1`-ben fut, az Atlas Frankfurtban. Meleg kérés alapideje kb. 0,4 s, hideg route 3–3,7 s | Minden nézet minden kérését érinti; a legolcsóbb, legnagyobb hatású lépés | 🔴 | S |

**Jelenlegi állapot**
- Az `apps/web` mappában nincs `vercel.json`, a `next.config.mjs` nem állít régiót, ezért a function a Vercel alapértelmezett `iad1` régiójában fut. A production válasz fejléce: `x-vercel-id: fra1::iad1::…` (edge Frankfurtban, function Washingtonban).
- Az Atlas cluster Frankfurtban van (`eu-central-1`).
- `lib/db.ts:10–18`: instance-onként egy cache-elt Mongoose kapcsolat. Hideg instance-on a kapcsolat felépítése több oda-vissza kör az óceánon át.

**Probléma**
- Minden Mongo művelet kb. 90 ms hálózati kört fizet oda-vissza, a nagy eredmények (a `/api/projects` rebuild 241 968 + 159 681 dokumentuma) pedig az óceánon utaznak át.
- Mért következmény: a `/api/tags` (egyetlen `find` 4 dokumentumra) melegen 396–632 ms, hidegen 2 954 ms. A `/api/groups` (5 dokumentum) hidegen 3 627 ms. A `/api/reviews/businesses` lekérdezése a MongoDB-ben 0 ms, production-ön 4 024 ms.
- A dashboard megnyitása 6 külön route-ot hív (`folders`, `projects`, `tags`, `leads`, `categories`, `calls`), mindegyik külön fizetheti a hideg indulást.
- Ha nem javítjuk, a terv többi feladata csak a maradék időt csökkenti: ez a késleltetés minden kérésen rajta marad.

**Megoldás**
1. Hozd létre az `apps/web/vercel.json` fájlt:
   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "regions": ["fra1"]
   }
   ```
   A Hobby csomag egy function régiót enged, ez elég.
2. Vercel dashboard → `gridleads` projekt → Settings → Functions: a Fluid Compute legyen bekapcsolva. Így a megnyitáskor párhuzamosan érkező kérések meleg instance-okon és meglévő Mongo kapcsolaton osztoznak.
3. Deploy production-re (a deploy a tulajdonos dolga, AGENTS.md §09).
4. `docs/ARCHITECTURE.md` §09: a „Production web” sor egészüljön ki a function régióval (`fra1`, az Atlas cluster mellett).
5. `apps/web/README.md` „Run” szakasz: egy mondat arról, hogy a function régiót a `vercel.json` rögzíti, és miért.

**Elfogadási feltételek (acceptance criteria)**
- A production `/api/tags` válasz `x-vercel-id` fejléce `fra1::fra1::`-gyel kezdődik.
- A `/api/tags` meleg TTFB-je öt egymást követő kérés mediánjában 150 ms alatt van (baseline: 396–632 ms).
- Egy 15 perce nem hívott route első kérése 1,5 s alatt válaszol (baseline: 2 954–3 664 ms).
- A két extension sync-je és a review mentés változatlanul működik.

**Tesztelés**
- A Függelék „Kérések mérése” snippetje a dashboardon, deploy előtt és után.
- Kézi próba: egy projekt sync a fő extensionből, egy review mentés az `extension-reviews`-ból, egy email generálás (OpenAI) és egy Vapi státusz lekérés a dashboardról.

**Függőségek és kockázatok**
- Nincs előfeltétele; ezzel érdemes kezdeni, mert minden későbbi mérés ehhez viszonyít.
- Az OpenAI, Vapi és Resend hívások ezután Európából indulnak. Ezek ritka, felhasználó által indított műveletek, a késleltetésük nem számottevő.
- A `landing` és a `tokenleads` külön Vercel projekt, ugyanazt a clustert olvassák. Ez a feladat nem érinti őket.
- Ha az Atlas Network Access listája konkrét IP-kre szűkítene, a régióváltás után a kapcsolat megszakadna. A Vercel function-ök IP-je nem fix, ezért a lista ma is nyitott kell legyen; deploy után az első kérésnél ellenőrizd, hogy nincs `MongoServerSelectionError`.

### B. `/api/projects` payload és cache

#### 2. Tartalom-alapú ETag és stale kiszolgálás háttér-rebuilddel

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | Tartalom-alapú ETag és stale kiszolgálás háttér-rebuilddel | `app/api/projects/route.ts`, `lib/projectStats.ts`, `lib/cache.ts` (új) | Az ETag a rebuild időbélyege, a TTL 120 s: 2 percenként 5,88 MB újra letöltődik változatlan adatnál is, a kérés közben 4,4–14 s a rebuild | A megnyitás leglassabb hálózati lépése | 🔴 | S |

**Jelenlegi állapot**
- `app/api/projects/route.ts:23–24`: `CACHE_KEY = 'projects'`, `TTL_MS = 120_000`.
- `getProjectsGz()` (`route.ts:40–49`): ha a `caches` dokumentum 120 s-nál régebbi, a kérésen belül lefut a `computeProjects()` (`route.ts:53–69`), a gzip és a kb. 5,9 MB-os dokumentum visszaírása, új `at` időbélyeggel.
- `GET` (`route.ts:76–95`): `const etag = \`"p${at}"\`` (79. sor). Az ETag tehát a build időpontja, nem a tartalom.
- `lib/projectStats.ts:52–67`: a `recomputeProjectStats()` szándékosan nem törli a cache-t, a TTL-re bízza a frissülést.

**Probléma**
- 120 s után minden megnyitás új `at` értéket, tehát új ETaget kap. A böngésző `If-None-Match` fejléce nem egyezik, a teljes 5,88 MB újra letöltődik, akkor is, ha egyetlen szám sem változott. A 304 csak a 2 perces ablakon belül működik.
- A rebuild a kérésen belül fut: a mért TTFB 4,4 s és 14,0 s. A két forrás collection kiolvasása önmagában 4,7 s + 3,5 s.
- Ha nem javítjuk: a dashboard minden olyan megnyitása, ami több mint 2 perccel követi az előzőt, 8–20 s hálózati várakozással indul, és a Fast Origin Transfer kvótát is ez fogyasztja (a route kommentje szerint ez korábban már gond volt).

**Megoldás**
1. Új `lib/cache.ts` (szerver modul, named exportok), a `caches` collection fölé, native driverrel, ahogy a route ma is használja:
   - `readCache(key)`: visszaadja a dokumentumot (`gz`, `at`, `hash`) vagy `null`-t.
   - `writeCache(key, { gz, hash, at })`: `updateOne` upserttel.
   - `claimRebuild(key, now)`: `findOneAndUpdate({ key, $or: [{ rebuildingAt: { $exists: false } }, { rebuildingAt: { $lt: now - 60_000 } }] }, { $set: { rebuildingAt: now } })`. Csak az a kérés épít újra, amelyik megszerzi; a 60 s-os lejárat egy megszakadt rebuild után feloldja.
   - A 15. és a 19. feladat ugyanezt a modult használja.
2. `route.ts`: a build számoljon tartalom hash-t a tömörítetlen JSON-ból: `createHash('sha1').update(body).digest('base64url')`. A cache dokumentum mezői: `{ key, gz, at, hash }`.
3. `GET`: az ETag legyen `"p${hash}"`. Az `If-None-Match` összevetése marad (a `W/` előtag levágásával együtt).
4. `getProjectsGz()` új ágai:
   - Friss dokumentum (`at` 120 s-on belül, van `hash`): kiszolgálás, ahogy ma.
   - Lejárt dokumentum: azonnali kiszolgálás a régi tartalommal, és `after(() => rebuildProjectsCache())` a `next/server`-ből. A rebuild a válasz elküldése után fut, a route `maxDuration = 60` keretén belül.
   - Nincs dokumentum, vagy nincs benne `hash` (régi formátum): build a kérésen belül, ahogy ma.
5. `rebuildProjectsCache()`: `claimRebuild` után `computeProjects()`, hash. Ha a hash megegyezik a tárolttal, csak `$set: { at }` és `$unset: { rebuildingAt }` fut (nincs 5,9 MB-os írás). Ha eltér: `writeCache`.
6. `lib/projectStats.ts:33–36` `invalidateProjectsCache()`: marad `deleteOne`. Szerkezeti módosítás (rename, move, delete, organize, Recount) után a következő `GET` a kérésen belül épít, mert a változásnak azonnal látszania kell.
7. `docs/ARCHITECTURE.md` §06: a „`/api/projects` payload is cached in MongoDB, gzipped, with an ETag” pont egészüljön ki azzal, hogy az ETag tartalom hash, és a lejárt cache azonnal kiszolgálódik, a frissítés a válasz után fut.

**Elfogadási feltételek (acceptance criteria)**
- Két `GET /api/projects` között 3 perc telik el, közben nincs adatváltozás: a második válasz 304, a `transferSize` 1 KB alatt van.
- Lejárt cache mellett a `GET /api/projects` TTFB-je 1 s alatt van (baseline: 4,4–14,0 s), és a `caches` dokumentum `at` mezője a kérés után 60 s-on belül frissül.
- Projekt átnevezése után a következő `GET` 200-as, új ETaggel, és az új nevet tartalmazza.
- Két párhuzamos kérés lejárt cache mellett egyetlen rebuildet indít (a `rebuildingAt` mező egyszer íródik).

**Tesztelés**
- Függelék „Kérések mérése” snippet: megnyitás, 3 perc várakozás, újratöltés; a `/api/projects` sor státusza és `transferSize`-a.
- Kézi próba: projekt átnevezés, mappába mozgatás, törlés, Organize, Σ Recount után a sidebar azonnal az új állapotot mutatja.
- Scrape közben (a számlálók változnak): a sidebar számai legfeljebb két megnyitás késéssel követik a változást (az első megnyitás a régi tartalmat kapja és elindítja a rebuildet).

**Függőségek és kockázatok**
- Az 1. feladat után a rebuild is gyorsabb, de ez a feladat nélküle is működik.
- A stale kiszolgálás miatt scrape közben a számok egy megnyitással később frissülnek, mint ma. Ez elfogadott kompromisszum (stale-while-revalidate döntés).
- Az `after()` a Vercel `waitUntil` mechanizmusára épül; ha a function a rebuild közben leáll, a `rebuildingAt` 60 s után lejár, és a következő kérés újrapróbálja.
- A 19–21. feladat után a teljes payloadot a kliens már nem kéri; a `lib/cache.ts` modul addig és utána is használatban marad.

#### 3. Kompakt, oszlopos payload

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | Kompakt, oszlopos payload | `app/api/projects/route.ts`, `lib/projectsPayload.mjs` (új), `lib/api.ts` | 271 byte projektenként: ismétlődő kulcsok, duplikált `name`, 82 287 csupa nulla sor | Kisebb letöltés és parse minden tartalomváltozásnál | 🟠 | S |

**Jelenlegi állapot**
- `computeProjects()` (`route.ts:53–69`) projektenként 13 kulcsú objektumot ad: `query`, `name`, `createdAt`, `folderId`, `total`, `noWebsite`, `hot`, `email`, `emailMiss`, `reviews`, `reviewsSum`, `ai`, `oppSum`.
- Mért méret: 65 601 382 karakter 241 968 projektre, azaz 271 karakter projektenként; gzip után 5 884 182 byte.
- A `name` 241 513 esetben azonos a `query`-vel. 82 287 projekt minden számlálója 0. A `folderId` értékkészlete legfeljebb 774 féle.
- A `GET /api/projects` egyetlen fogyasztója a `lib/api.ts:53` `getProjects`, amit a `lib/store.ts:58` és `:62` hív. Az extensionök nem hívják.

**Probléma**
- A payload nagyobb része kulcsnév és ismétlés. Minden tartalomváltozás után (scrape közben folyamatosan) ez a méret töltődik le és parse-olódik.
- Ha nem javítjuk: a 2. feladat után is 5,88 MB megy át minden olyan megnyitásnál, amikor egy számláló változott, és a méret a projektszámmal együtt nő tovább.

**Megoldás**
1. Új `lib/projectsPayload.mjs` (tiszta függvények, a `lib/organize.mjs` mintájára), két named exporttal:
   - `encodeProjects(list)` → `{ v: 2, folders: string[], rows: unknown[][] }`.
   - `decodeProjects(payload)` → a mai `ProjectSummary[]`.
2. Egy sor formátuma: `[query, name, createdAt, folderIdx, total, noWebsite, hot, email, emailMiss, reviews, reviewsSum, ai, oppSum]`, ahol
   - `name` `0`, ha megegyezik a `query`-vel, különben a string;
   - `createdAt` epoch milliszekundum számként, ha `new Date(n).toISOString()` pontosan visszaadja az eredeti stringet, különben az eredeti string;
   - `folderIdx` a `folders` tömb indexe, `-1` ha nincs mappa;
   - ha mind a kilenc számláló 0, a sor a `folderIdx` után véget ér, a decoder nullákkal tölti ki.
3. `route.ts`: a `getProjectsGz()` az `encodeProjects(await computeProjects())` eredményét tömörítse. A `computeProjects()` exportja változatlan marad.
4. `lib/api.ts:53`: `getProjects: async () => decodeProjects(await jget('/api/projects'))`. A `decodeProjects` tömböt kapva (régi formátum, pl. a böngésző HTTP cache-éből) változatlanul adja vissza, így a deploy pillanatában sincs törés.
5. `lib/projectsPayload.test.mjs`: `node:test` round-trip teszt az esetekre: `name === query`, eltérő `name`, nem ISO `createdAt`, hiányzó `folderId`, csupa nulla számláló, régi formátumú bemenet.
6. `apps/web/README.md` „API” szakasz: a `GET /api/projects` válasz formátumának leírása.

**Elfogadási feltételek (acceptance criteria)**
- A `GET /api/projects` kitömörített mérete 30 MB alatt van (baseline: 65,6 MB), a `transferSize` kisebb a mai 5,88 MB-nál.
- `decodeProjects(encodeProjects(x))` mélyen egyenlő `x`-szel a production adat formájára (a teszt fixture-ök alapján).
- A sidebar projektszáma, a folder badge-ek és a hat csempe értéke megegyezik a változtatás előttivel.
- `node --test apps/web/lib/projectsPayload.test.mjs` zöld, `npm --prefix apps/web run typecheck` hibátlan.

**Tesztelés**
- Unit teszt a fenti parancsokkal.
- Kézi összevetés: a változtatás előtt jegyezd fel a „Total leads”, „No website”, „Hot leads” csempét és a sidebar fejléc „N folders · M projects” szövegét; deploy után egyezniük kell.
- Függelék „Kérések mérése”: a `/api/projects` sor `decoded` és `transfer` oszlopa.

**Függőségek és kockázatok**
- A 2. feladat után érdemes, mert a formátumváltás az ETaget is megváltoztatja (egyszeri teljes letöltés).
- Az API szabály szerint meglévő endpoint válaszformátuma nem változhat, mert kliensek függnek tőle. Itt az egyetlen kliens a `lib/api.ts`, és ugyanabban a commitban változik; a `v: 2` mező és a régi formátum elfogadása fedezi az átmenetet.
- A 30 MB-os cél becslésre épül (kb. 96 karakter soronként); a pontos méret a tényleges adattól függ, ezért a feltétel küszöbérték, nem pontos szám.
- A 21. feladat után a teljes lista letöltése megszűnik; a formátumot a 20. feladat folder szintű válasza használja tovább.

#### 4. Kliens stale-while-revalidate a HTTP cache-ből

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | Kliens stale-while-revalidate a HTTP cache-ből | `lib/api.ts`, `lib/store.ts`, `app/api/folders/route.ts` | A sidebar meleg cache mellett is megvárja a hálózati revalidációt (1,3–1,8 s), addig skeleton | A sidebar azonnal megjelenik a legutóbbi állapottal | 🟠 | S |

**Jelenlegi állapot**
- `lib/api.ts:5`: `jget` sima `fetch(url)`. A `/api/projects` válasz `Cache-Control: private, no-cache`, ezért a böngésző eltárolja, de minden használat előtt revalidál.
- `lib/store.ts:57–60` `hydrate()`: `Promise.all([api.getFolders(), api.getProjects()])`, a `hydrated` csak mindkettő után lesz igaz.
- `app/api/folders/route.ts:9–13`: a `GET` nem küld `ETag`-et és `Cache-Control`-t; a válasz 128 KB, melegen 0,8–1,3 s.

**Probléma**
- Változatlan adatnál is 1,3–1,8 s telik el a sidebar megjelenéséig, pedig a tartalom már ott van a böngésző cache-ében.
- Ha nem javítjuk: a sidebar és a csempék minden megnyitásnál skeletonnal indulnak, a 2. feladat nyeresége ellenére.

**Megoldás**
1. `app/api/folders/route.ts` `GET`: számolj `sha1` hash-t a válasz JSON-ból, küldd `ETag`-ként `Cache-Control: private, no-cache` mellett, és egyező `If-None-Match` esetén adj body nélküli 304-et. A válasz továbbra is csupasz tömb.
2. `lib/api.ts`: új belső segédfüggvény `jgetWithEtag(url, cache)`, ami `fetch(url, { cache })` után `{ data, etag }`-et ad vissza. Új wrapperek:
   - `getProjectsCached()` és `getFoldersCached()`: `cache: 'force-cache'`. A böngésző a tárolt választ adja hálózat nélkül; ha nincs tárolt válasz, magától a hálózathoz fordul.
   - `getProjectsFresh()` és `getFoldersFresh()`: `cache: 'no-cache'` (revalidáció `If-None-Match`-csel).
   - A meglévő `getProjects` és `getFolders` a `Fresh` változatra mutasson, így a többi hívó nem változik.
3. `lib/store.ts` `hydrate()`:
   1. `Promise.all([getFoldersCached(), getProjectsCached()])` → `set({ folders, summaries, hydrated: true })`, és a két ETag eltárolása a store-ban (`etags: { folders, projects }`).
   2. Ezután `Promise.all([getFoldersFresh(), getProjectsFresh()])`; csak annál hívj `set`-et, amelyiknek az ETagje eltér az eltárolttól.
4. `refresh()` (`store.ts:61–64`): a `Fresh` változatot hívja, és frissíti az eltárolt ETageket.
5. `docs/ARCHITECTURE.md` §04 „State”: egy mondat arról, hogy a store a HTTP cache-ből tölt először, majd revalidál.

**Elfogadási feltételek (acceptance criteria)**
- Meleg cache melletti újratöltésnél a sidebar első folder sora megjelenik, mielőtt a `/api/projects` hálózati kérése befejeződik.
- Ha a revalidáció 304, a store nem kap második `set`-et (a `tree` memo nem fut le újra).
- Üres böngésző cache-nél (első látogatás, privát ablak) a betöltés hibátlan, pontosan egy `/api/projects` és egy `/api/folders` hálózati kéréssel.
- Egy másik fülön átnevezett projekt új neve az újratöltés után legfeljebb a revalidáció idejével késve megjelenik.

**Tesztelés**
- DevTools Network: újratöltésnél a `/api/projects` első sora „(disk cache)”, a második 304.
- DevTools Performance: a sidebar első renderje és a `/api/projects` hálózati válasza közti sorrend.
- Privát ablakban teljes betöltés.

**Függőségek és kockázatok**
- A 2. feladat kell előtte: tartalom-alapú ETag nélkül a revalidáció 2 perc után mindig eltérést jelezne.
- A felhasználó rövid ideig a legutóbb látott állapotot látja; ha közben máshol történt módosítás, a lista a revalidáció végén egyszer átrendeződhet. Ez elfogadott (stale-while-revalidate döntés).
- A `force-cache` a böngésző HTTP cache-ére épül; ha a böngésző üríti (tárhely nyomás, privát mód), a viselkedés a mai marad, nem romlik.
- A 21. feladat után ugyanez a minta a `GET /api/sidebar` hívásra kerül át.

### C. Dashboard első render

#### 5. A lead tábla ne várjon a sidebarra

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | A lead tábla ne várjon a sidebarra | `components/Dashboard.tsx` | A `/api/leads` kérés csak `hydrated` után indul: 11,2–20,7 s-nál, miközben maga 0,5 s | Az első használható tartalom 10–20 s-mal korábban jelenik meg | 🔴 | S |

**Jelenlegi állapot**
- `Dashboard.tsx:397–412`: a lead oldal lekérő effect első sora `if (!hydrated) return;`, a `hydrated` a dependency listában is szerepel.
- `Dashboard.tsx:373`: `useEffect(() => { if (hydrated) refreshCallCount(); }, …)`: a `calls?count=1` és a `countChecked` kérés is a hydrate-re vár.
- `Dashboard.tsx:932–972`: amíg `!hydrated`, a komponens egy teljes oldalas skeletont ad vissza, a valódi layout (kereső, szűrők, tábla) meg sem jelenik.
- Az alap nézet lekérése (`project`, `folder`, `group` nélkül) semmit nem használ a `summaries`-ból vagy a `folders`-ből.

**Probléma**
- A mért idővonalon a `/api/leads` hidegen 20 658 ms-nál, melegen 11 248 ms-nál indul, pedig a navigáció után 1,4 s-mal indulhatna, és 0,5–0,6 s alatt válaszol.
- Ha nem javítjuk: a felhasználó akkor is 10–20 s-ig skeletont néz, amikor a tábla adata 2 s-on belül megvan.

**Megoldás**
1. `Dashboard.tsx:398`: töröld a `if (!hydrated) return;` sort, és vedd ki a `hydrated`-et az effect dependency listájából (412. sor).
2. `Dashboard.tsx:373`: a `refreshCallCount()` fusson mount után és `reloadKey` változáskor, `hydrated` feltétel nélkül.
3. `Dashboard.tsx:932–972`: szűnjön meg a teljes oldalas skeleton ág. A valódi layout mindig renderelődjön, és csak a store-függő részek mutassanak skeletont, amíg `!hydrated`:
   - sidebar: a `<nav className="nav">` tartalma helyett a mai 10 darab `.skel-bar` sor, a `.side-count` üres;
   - csempék: a hat `.widget` a mai skeleton tartalommal;
   - a típus/régió/ország szűrők `disabled` állapotban (az opcióik a `summaries`-ból jönnek).
4. Tábla betöltési állapot: ha `loading` és `pageRows.length === 0`, a `<tbody>` helyén a mai 14 darab `.skel-bar` sor jelenjen meg (a `.skel-bar` osztály létezik, `globals.css:752`).
5. Tábla hiba állapot: új `loadError` state. A `.catch` ág állítsa be; ilyenkor az „empty” blokk helyén ez álljon: `Could not load leads. Use Refresh to try again.` Sikeres lekérés törli.

**Elfogadási feltételek (acceptance criteria)**
- A `/api/leads` kérés `startTime` értéke a navigáció kezdetétől 2 000 ms alatt van, hideg és meleg cache mellett is (baseline: 20 658 ms és 11 248 ms).
- Hideg cache mellett az első lead sorok láthatók, miközben a sidebar még skeletont mutat.
- A `/api/calls?count=1` és a `/api/leads?countChecked=1` kérés ugyanabban a hullámban indul, mint a `/api/leads`.
- Sikertelen `/api/leads` válasznál a hibaüzenet jelenik meg, nem a „No leads here” szöveg.

**Tesztelés**
- Függelék „Kérések mérése”: a `/api/leads` sor `start` oszlopa.
- DevTools Network: a `/api/projects` kérést „Slow 3G” throttlinggal lassítva a tábla így is megjelenik.
- DevTools Network: a `/api/leads` kérés blokkolásával a hiba állapot ellenőrzése.
- `npm --prefix apps/web run typecheck`.

**Függőségek és kockázatok**
- Nincs előfeltétele.
- Amíg a 6–8. feladat nincs kész, a `/api/projects` megérkezése után a main thread még másodpercekre megáll. Ha a lead válasz pont ekkor érkezik, a megjelenése a blokk végéig késik; a tipikus sorrendben (leads 0,5 s, projects 1,8–8 s) a tábla előbb kész.
- A mappa- vagy projekt-scope-ú nézet továbbra is a `folders` betöltése után érhető el, mert a scope-ot a sidebarból lehet kiválasztani; ez nem változik.

#### 6. `parseProjectGeo` gyorsítása

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | `parseProjectGeo` gyorsítása | `lib/projectGeo.ts` | Projektenként 727 `endsWith`: 2,9 s a main threaden minden `summaries` változásnál | A 8,4 s-os long task harmada | 🔴 | S |

**Jelenlegi állapot**
- `lib/projectGeo.ts:15–17`: a `KNOWN` tömb 727 régiónév (országok, US államok, városok), hossz szerint csökkenő sorrendben; a `KNOWN_LC` ugyanez kisbetűvel.
- `parseProjectGeo()` (`projectGeo.ts:22–32`): a 29. sor ciklusa minden hívásnál végigmegy a `KNOWN_LC`-n, és `lc.endsWith(' ' + KNOWN_LC[i])`-t futtat az első találatig.
- `Dashboard.tsx:430`: a `countryOf` memo minden projektre meghívja (`[summariesArr]` dependency), tehát a hydrate és minden `refresh()` után 241 968-szor.
- `Dashboard.tsx:1236`: kiválasztott országnál a régió lista minden eleme is átmegy rajta, minden rendernél.

**Probléma**
- Benchmark 245 966 projektnéven: 2 877 ms. A US államnevek rövidek, ezért a hossz szerint rendezett lista végén vannak; a projektek többsége amerikai, így a ciklus szinte mindig végigfut.
- Ez a számítás a main threaden fut, a hydrate utáni 8,4 s-os long task része.
- Ha nem javítjuk: minden megnyitás, minden Refresh és minden olyan művelet után, ami `actions.refresh()`-t hív (törlés, Organize, Recount, Lead search), közel 3 s-ra megáll a felület.

**Megoldás**
1. Új `lib/regionLookup.mjs` egy tiszta függvénnyel: `findRegionSuffix(lc, byLc)`. Előbb a teljes `lc` stringet keresi a `Map`-ben, majd balról jobbra minden szóköz utáni szuffixet (`lc.slice(i + 1)`), és az első találatot adja vissza. A leghosszabb szuffix kerül sorra először, ez megegyezik a mai „leghosszabb név nyer” szabállyal.
2. `lib/projectGeo.ts`: a `KNOWN_LC` tömb helyett épüljön `BY_LC: Map<string, string>` (kisbetűs név → eredeti írásmód). A feltöltés a hossz szerint rendezett `KNOWN` sorrendjében történjen, és meglévő kulcsot ne írjon felül, így azonos kisbetűs alaknál ugyanaz az írásmód nyer, mint ma.
3. `parseProjectGeo()`: a 29. sor ciklusa helyett `region = findRegionSuffix(lc, BY_LC) || ''`. A tartalék ág (utolsó szó) és a `REGION_COUNTRY` keresés változatlan.
4. `countryRegex()` (`projectGeo.ts:41–45`), `typeRegex()` és `regionRegex()` nem változik.
5. `lib/regionLookup.test.mjs`: `node:test` esetek: több szavas régió (`"dentists near Soho New York"`), rövidebb név ne nyerjen a hosszabb előtt (`York` és `New York`), a teljes string maga régió, nincs találat, többszörös szóköz, nagybetűs bemenet.

**Elfogadási feltételek (acceptance criteria)**
- 240 000 projektnév feldolgozása Node-ban 400 ms alatt fut (baseline: 2 877 ms; a tervhez készült prototípus 229 ms).
- Az új és a régi implementáció eredménye minden tesztbemeneten azonos `{ type, region, country }`. A prototípus 245 966 bemeneten 0 eltérést adott.
- A dashboard „All countries” legördülőjének országai és darabszámai megegyeznek a változtatás előttivel.

**Tesztelés**
- `node --test apps/web/lib/regionLookup.test.mjs`.
- Kézi összevetés: jegyezd fel az ország legördülő tartalmát a változtatás előtt és után.
- DevTools Performance felvétel a dashboard betöltéséről: a `countryOf` memo ideje.

**Függőségek és kockázatok**
- Nincs előfeltétele.
- A `lib/projectScope.ts` a `countryRegex()`-et használja, ami nem változik, így a szerver oldali országszűrés ugyanazt adja.
- A 21. feladat után a `countryOf` memo megszűnik (az országok a szerverről jönnek), de a `parseProjectGeo` a szerveren tovább használatban marad, ott ugyanez a gyorsítás számít.

#### 7. „Ungrouped” csoport és sidebar windowing

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | „Ungrouped” csoport és sidebar windowing | `components/Dashboard.tsx`, `lib/windowing.mjs` (új), `app/globals.css` | 8 470 mappa nélküli projekt mind renderelve: 64 337 DOM node, minden állapotváltozásnál újrarenderelve | A long task maradéka, és a dashboard minden kattintása ettől akad | 🔴 | M |

**Jelenlegi állapot**
- `Dashboard.tsx:1106–1107`: a `<nav className="nav">` kirendereli a gyökér foldereket (`renderFolder`, rekurzív, 886–929. sor), majd a `tree.ungrouped` minden elemét (`renderProject`, 875–885. sor).
- Production-ön 8 470 mappa nélküli projekt van, mind a gyökérszinten. Betöltés után 8 471 `.navitem` és összesen 64 337 DOM node van az oldalon; a `.nav` magassága 315 879 px.
- A `Dashboard` egyetlen 1 378 soros komponens: bármely state változás (gépelés a keresőbe, hover drag közben, sor kijelölés) az egész sidebar fát újrarendereli.
- A görgető konténer a `.sidebar-scroll` (`globals.css:814`), a `.nav` maga `overflow: visible` (815. sor). Mért sormagasságok: projekt sor 33 px, folder sor 34 px, a `.nav` `row-gap` értéke 4 px.

**Probléma**
- A 64 ezer DOM node létrehozása a hydrate utáni long task része, és a React minden későbbi rendernél újra végigjárja a 8 470 sort.
- Ugyanez történik, ha valaki kinyit egy több ezer projektes foldert.
- Ha nem javítjuk: a 6. és 8. feladat után is másodperces blokk marad a betöltés végén, és a felület minden interakciónál akad.

**Megoldás**
1. **„Ungrouped” csoport.** Új state `ungroupedOpen`, alapértéke `false`, a `gridleads_ungrouped` localStorage kulcsban megőrizve (a `gridleads_collapsed` mintájára). A folderek után egy fejlécsor jelenik meg a `.folder` osztállyal: caret, `📁 Ungrouped`, `tree.ungrouped.length` badge, `title="Projects with no folder"`. Kattintásra nyit és zár. Nincs rajta checkbox, ikonválasztó, átnevezés és törlés, és nem drop target.
2. **Lapos sorlista.** Új `visibleRows` memo: a mai rekurzív bejárás (`renderFolder`) eredménye egy tömbben, elemei `{ kind: 'folder' | 'project' | 'ungrouped', depth, f?, p? }`. Figyelembe veszi a `collapsed` állapotot és a `filtered` halmazokat (szűrés közben minden találatot tartalmazó folder nyitva). Szűrés közben a mappa nélküli találatok az `ungroupedOpen` értékétől függetlenül bekerülnek.
3. **Windowing segédfüggvény.** Új `lib/windowing.mjs`:
   - `rowOffsets(heights, gap)`: kumulált kezdőpozíciók tömbje és a teljes magasság;
   - `visibleRange(offsets, scrollTop, viewportHeight, overscan)`: bináris kereséssel az első és utolsó látható index, plusz `padTop` és `padBottom`.
4. **Renderelés.** A `<nav className="nav">` csak a `visibleRange` által adott sorokat rendereli, előtte és utána egy-egy üres `<div>` a `padTop` és `padBottom` magassággal. Az overscan 20 sor. A sorok a meglévő `renderProject` és egy nem rekurzív `renderFolderRow` függvényből jönnek (a `renderFolder` 921–926. sorának rekurziója megszűnik, a behúzás a `depth`-ből számolódik, ahogy ma).
5. **Görgetés követése.** `scroll` listener a `.sidebar-scroll` elemen `requestAnimationFrame`-mel ritkítva; a lista kezdete a `nav` elem `offsetTop` értéke, a viewport a konténer `clientHeight`-ja. `ResizeObserver` a konténeren az ablakméret változásához.
6. **Rögzített sormagasság.** `globals.css`: a `.navitem` kapjon `height: 33px`, a `.folder` `height: 34px`, mindkettő `box-sizing: border-box`. Ezek a ma renderelt értékek, a megjelenés nem változik. A `visibleRows` a `kind` alapján adja a magasságot, a `gap` 4 px.
7. **Sorrend a kijelöléshez.** A `tree.order` (513–521. sor) és a `filtered.order` (589–596. sor) helyett a shift-kattintásos tartománykijelölés a `visibleRows` projekt sorainak sorrendjét használja.
8. `docs/ARCHITECTURE.md` §04 „State”: a `localStorage` kulcsok listájába kerüljön be a `gridleads_ungrouped`.
9. `docs/DESIGN_SYSTEM.md`: a web osztály-konvenciók mellé (a `.side-*` előtagot leíró pontnál) kerüljön be, hogy a sidebar sorok magassága rögzített (projekt 33 px, folder 34 px, köz 4 px), mert a windowing ezekkel számol.

**Elfogadási feltételek (acceptance criteria)**
- Betöltés után az oldal DOM node száma 5 000 alatt van (baseline: 64 337).
- Kinyitott „Ungrouped” csoportnál és bármely görgetési pozícióban a `.navitem` elemek száma 150 alatt marad.
- A `.sidebar-scroll` `scrollHeight` értéke kinyitott „Ungrouped” mellett megegyezik a windowing nélküli értékkel (a görgetősáv nem ugrál).
- Működik: folder nyitás/zárás, folder drag-and-drop másik folderre és az „All leads” sorra, több folder együttes húzása, shift-kattintásos projekt- és folder-tartománykijelölés, a szöveges és a típus/régió szűrő, a „Select all N filtered projects”.
- A szűrő találatai között a mappa nélküli projektek zárt „Ungrouped” mellett is megjelennek.

**Tesztelés**
- `lib/windowing.test.mjs` (`node:test`): üres lista, a viewportnál rövidebb lista, görgetés a közepére és a végére, vegyes sormagasság; minden esetben `padTop + a renderelt sorok magassága + padBottom` egyenlő a teljes magassággal.
- Kézi ellenőrző lista az elfogadási feltételek interakcióira.
- Függelék „DOM és long task mérés” snippet betöltés után.

**Függőségek és kockázatok**
- A 8. feladattal együtt érdemes elkészíteni: mindkettő a `tree` memót és a sidebar renderelést írja át.
- Nem kerül be új dependency (a windowing saját kód, a döntés szerint).
- A natív böngésző kereső (Ctrl+F) a nem renderelt sorokat nem találja meg; erre a sidebar saját szűrője szolgál.
- Ha egy sor tartalma a rögzített magasságnál magasabbra törne (hosszú név több sorban), a pozíciók elcsúsznának. A `.ni-name` és az `.fname` ma is egysoros, `title` attribútummal; ennek így kell maradnia.
- A 21. feladat ugyanerre a lapos listára épít, a betöltés alatt álló folderek helykitöltő soraival kiegészítve.

#### 8. `tree` és `accurateMissing` memo szétbontása

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | `tree` és `accurateMissing` memo szétbontása | `components/Dashboard.tsx` | Egy folder nyitása/zárása újracsoportosítja mind a 241 968 projektet és újraszámolja mind a 774 folder coverage badge-ét | A sidebar minden kattintása akad | 🟠 | S |

**Jelenlegi állapot**
- `Dashboard.tsx:438–527`: a `tree` memo dependency-je `[summariesArr, folderList]`. Egy menetben csoportosítja és rendezi a projekteket folderenként, kiszámolja a rekurzív összegeket, a leszármazott halmazokat, a badge számokat, az olcsó `missingOf` becslést, a látható sorrendet és a lapos folder listát.
- `lib/store.ts:88–91`: a `setFolderCollapsed` új `folders` objektumot hoz létre, ettől a `folderList` is új tömb lesz.
- `Dashboard.tsx:541–564`: az `accurateMissing` memo dependency-je `[covData, tree, folderList, folders]`. Minden nem gyökér folderre összefűzi a leszármazott projektek normalizált nevét egy stringbe, és a referencia lista minden elemére `includes`-t futtat rajta.
- `Dashboard.tsx:531–537`: a referencia adat (`lib/states.ts` 468 KB, `lib/countryAreas.ts` 392 KB) a komponens mountjakor mindig betöltődik.

**Probléma**
- Egy folder kinyitása vagy becsukása a teljes `tree` memót újrafuttatja 241 968 projekten, utána az `accurateMissing` mind a 774 folderre. Mikro-benchmark: egy 400 projektes állam-folder badge-e kb. 5 ms, a teljes kör tehát másodperces nagyságrendű, minden kattintásnál.
- Ugyanez lefut a hydrate után is, a long task részeként.
- Ha nem javítjuk: a 7. feladat után a DOM már kicsi, de a sidebar minden kattintása továbbra is érezhetően késik.

**Megoldás**
1. Bontsd a `tree` memót négy részre:
   - `projIndex`, dependency `[summariesArr]`: `projsOf` (projektek `folderId` szerint, `byCreated` rendezéssel) a folder létezésének vizsgálata nélkül.
   - `folderTree`, dependency egy `folderShape` kulcs: `childrenOf`, `roots`, `descOf`, `folderCountOf`, `flat`. A `folderShape` a folderek `id`, `parentId`, `name`, `order` mezőiből összefűzött string, tehát a `collapsed` és az `icon` változása nem érvényteleníti.
   - `folderTotals`, dependency `[projIndex, folderTree]`: `ungrouped` (azok a projektek, amelyek `folderId`-ja üres vagy nem létező folderre mutat), `totalOf`, `projCountOf`, `zeroCountOf`, `missingOf`.
   - a nyitottságtól függő rész a 7. feladat `visibleRows` memója.
2. Az `accurateMissing` memo helyett lusta, folderenkénti számítás: `missingFor(folderId)` egy `useRef(new Map())` cache-sel. A cache akkor ürül, ha a `covData`, a `projIndex` vagy a `folderTree` változik. A függvényt csak a ténylegesen renderelt folder sorok hívják (a 7. feladat után néhány tucat). A számítás módja változatlan (token keresés a nevekből összefűzött stringben), így az eredmény továbbra is megegyezik a coverage modallal.
3. A `Dashboard.tsx:909` badge kifejezése a `missingFor(f.id) ?? tree.missingOf[f.id]` értéket használja.

**Elfogadási feltételek (acceptance criteria)**
- Folder nyitása és zárása közben nincs 200 ms-nál hosszabb long task (Függelék „DOM és long task mérés”).
- A `projIndex` memo folder nyitáskor, záráskor és ikonváltáskor nem fut le újra.
- A piros „missing” badge értéke minden folderen megegyezik a változtatás előttivel, és a coverage modal (ⓘ) ugyanazt a számot mutatja.
- A folder badge-ek (összes lead, sub-folder, projekt, 0 leades projekt) értéke változatlan.

**Tesztelés**
- Kézi összevetés öt folderen (egy gyökér, két állam, két város): badge értékek a változtatás előtt és után.
- DevTools Performance felvétel: folder kinyitása, a long task hossza.
- `npm --prefix apps/web run typecheck`.

**Függőségek és kockázatok**
- A 7. feladattal egy lépésben célszerű, mert a lusta badge számítás a renderelt sorok kis számára épít.
- A `folderShape` kulcsból kimaradó mező (pl. egy később bevezetett, a fát befolyásoló tulajdonság) elavult fát eredményezne; a kulcs összeállítása mellé kerüljön rövid komment erről.
- A 22. feladat a pontos badge számítást a szerverre viszi, ekkor a `missingFor` és a `covData` betöltés megszűnik.

#### 9. `CategoryFilter` lusta betöltése

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | `CategoryFilter` lusta betöltése | `components/CategoryFilter.tsx` | Megnyitáskor és minden scope váltáskor lefut egy `$group` az összes leaden (3,2–6,0 s), akkor is, ha a legördülőt senki nem nyitja ki | Felesleges terhelés a megosztott clusteren minden betöltésnél | 🟠 | S |

**Jelenlegi állapot**
- `CategoryFilter.tsx:17–25`: az effect a komponens mountjakor és minden `project` / `folder` változásnál meghívja az `api.getCategories()`-t, függetlenül attól, hogy a legördülő nyitva van-e.
- `app/api/categories/route.ts:25–29`: scope nélkül üres `$match` után `$group` kategória szerint a teljes `leads` collectionön.
- Mérés: production-ön 3,2 s és 6,0 s, 197 KB válasz. A MongoDB-ben 2,3 s; a `tl_category_score` indexre hintelve is 2,1 s, tehát indexszel nem gyorsítható érdemben. Gyökér folderre 2,6 s, levél folderre 1,1 s, egy projektre 0,3 s.

**Probléma**
- A dashboard minden megnyitása elindít egy 2–6 s-os teljes collection aggregációt, aminek az eredményét a felhasználó többnyire meg sem nézi. Ez a megosztott Flex clusteren a párhuzamosan futó többi lekérdezést is lassítja.
- Ha nem javítjuk: a `.claude/rules/database.md` szabálya („no `$group` over the whole `leads` collection in a request”) minden betöltésnél sérül.

**Megoldás**
1. `CategoryFilter.tsx`: a lekérés csak akkor induljon, amikor az `open` igazra vált, és az aktuális scope-ra még nincs betöltött lista.
2. A betöltött listák egy `useRef(new Map())` cache-be kerülnek, a kulcs `${project || ''}|${folder || ''}`. Scope váltáskor a megjelenített lista ürül; újranyitáskor a cache-ből jön, ha van.
3. A „Loading…” felirat (53. sor) marad a betöltés idejére. Hiba esetén a lista helyén: `Could not load categories.`
4. A gomb felirata (`🏷 Categories (N)`) csak a kiválasztott kategóriák számát mutatja, ehhez nem kell a lista.
5. A `Dashboard.tsx:368` effect (scope váltáskor a kiválasztott kategóriák törlése) nem változik.

**Elfogadási feltételek (acceptance criteria)**
- A dashboard megnyitása nem indít `/api/categories` kérést.
- A legördülő első kinyitása pontosan egy kérést indít; ugyanazon scope-on az újranyitás egyet sem.
- Scope váltás után (másik folder) a következő kinyitás az új scope-ra kér.
- A kategória szerinti szűrés eredménye változatlan.

**Tesztelés**
- DevTools Network a fenti négy lépéssel.
- `npm --prefix apps/web run typecheck`.

**Függőségek és kockázatok**
- Nincs előfeltétele.
- Az „All leads” scope-on a legördülő első kinyitása továbbra is 2–3 s (az 1. feladat után ennyi a MongoDB-beli idő). Ez tudatos kompromisszum: a naprakész számok fontosabbak, mint egy előre számolt, elavuló lista (a Categories nézet cache-e jelenleg 2026-07-23-i).
- A komponensen belüli cache miatt egy scrape közben újranyitott legördülő a korábbi számokat mutatja az oldal újratöltéséig.

### D. Lead tábla lekérdezések

#### 10. Rendezés index szerint (`_id` tie-break, `name` index)

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | Rendezés index szerint (`_id` tie-break, `name` index) | `app/api/leads/route.ts`, `lib/models.ts` | Az `_id` tie-break miatt az `opportunityScore` és `leadScore` kivételével minden rendezés `COLLSCAN` + `SORT`: 2,8–19 s | Oszlopfejre kattintás ma másodpercekig tart | 🟠 | S |

**Jelenlegi állapot**
- `app/api/leads/route.ts:14–17`: a `sortField()` a `leadTemperature` kivételével bármilyen kapott kulcsot változtatás nélkül visszaad; nincs whitelist.
- `route.ts:89`: `.sort({ [field]: dir, _id: 1 })`. Az `_id` másodlagos kulcs minden rendezésnél ott van.
- Olyan index, amely az `_id`-t is tartalmazza, csak kettő van: `gl_opp_sort { opportunityScore: -1, _id: 1 }` és `tl_leadscore_sort { leadScore: -1, _id: 1 }`. A többi rendezhető mezőn egymezős index van (`rating_1`, `reviewCount_1`, `scrapedAt_1`, `websiteStatus_1`, `email_1`, `call_1`), vagy semmilyen (`name`, `address`, `phone`, `checked`, `salesStatus`).
- A rendezhető oszlopok listája: `Dashboard.tsx:145–155` (`sortable: true` elemek).

**Probléma**
- Egy `{ rating: 1 }` index nem tudja kiszolgálni a `{ rating: -1, _id: 1 }` rendezést, ezért a MongoDB az egész collectiont beolvassa és memóriában rendez. Mért `explain` az összes leadre: `rating` 2,8 s, `reviewCount` 3,3 s, `email` 3,0 s, `websiteStatus` 3,5 s, `scrapedAt` 4,8 s, `category` 5,7 s, `name` 19,0 s; mindegyik `SORT ← COLLSCAN`, 1 603 177 vizsgált dokumentummal.
- Ugyanezek `_id` nélkül: 1 ms, `IXSCAN`, 50 vizsgált dokumentum.
- A növekvő `opportunityScore` rendezés (`{ opportunityScore: 1, _id: 1 }`) sem illeszkedik a `gl_opp_sort` indexre, mert az csak a `{ -1, 1 }` és a teljesen fordított `{ 1, -1 }` irányt szolgálja ki.
- Ha nem javítjuk: a „Highest rating”, „Most reviews”, „Name A–Z”, „Date” rendezés és az oszlopfejre kattintás az „All leads” nézetben 3–19 s marad, és minden ilyen kérés teljes collection scan a megosztott clusteren.

**Megoldás**
1. `route.ts`: a `sortField()` kapjon whitelistet a `Dashboard.tsx` rendezhető kulcsaival: `checked`, `name`, `category`, `rating`, `reviewCount`, `phone`, `email`, `websiteStatus`, `opportunityScore`, `leadScore`, `leadTemperature`, `address`, `scrapedAt`, `salesStatus`, `call`. Ismeretlen kulcs esetén `opportunityScore`. A `leadTemperature → opportunityScore` leképezés marad.
2. `route.ts:89`: a rendezés összeállítása új függvényben (`sortSpec(field, dir)`):
   - `opportunityScore` és `leadScore`: `{ [field]: dir, _id: dir === -1 ? 1 : -1 }`. Így mindkét irány illeszkedik a meglévő összetett indexre (előre vagy visszafelé olvasva).
   - minden más mező: `{ [field]: dir }`, `_id` nélkül.
3. `lib/models.ts`: két új index a `LeadSchema`-n: `{ name: 1 }` és `{ salesStatus: 1 }`. Az indexeket előbb az Atlas UI-ban hozd létre (Collections → `leads` → Indexes → Create Index), csúcsidőn kívül, és csak utána deployold a deklarációt, így a build nem egy éles kérés közben indul.
4. A `category` rendezést a meglévő `tl_category_score { category: 1, leadScore: -1 }` index szolgálja ki; a deklarációját a 12. feladat veszi fel a web kódjába.
5. `docs/ARCHITECTURE.md` §06: új pont arról, hogy a lead tábla rendezése szándékosan `_id` tie-break nélküli, mert azzal az egymezős indexek használhatatlanok.

**Elfogadási feltételek (acceptance criteria)**
- Az „All leads” nézetben a `rating`, `reviewCount`, `scrapedAt`, `websiteStatus`, `email`, `category` és `name` szerinti rendezés mindkét irányban 1 s alatt ad sorokat production-ön (baseline: név szerint 5,5 s).
- Az Atlas UI Explain Plan nézetében ezekre a rendezésekre nincs `SORT` szakasz, és a vizsgált dokumentumok száma megegyezik az oldalmérettel.
- Az `opportunityScore` szerinti növekvő rendezés is `IXSCAN gl_opp_sort`.
- Ismeretlen `sort` paraméter (`?sort=$where`) az alap rendezést adja, hibát nem.
- Lapozásnál azonos rendezés mellett két egymást követő oldalon nincs ismétlődő sor.

**Tesztelés**
- Kézi próba: minden rendezhető oszlopfej kétszer (mindkét irány) az „All leads” nézetben, majd egy folderben.
- Atlas UI → Collections → `leads` → Explain Plan a `{}` szűrővel és `{ rating: -1 }` rendezéssel.
- Függelék „Kérések mérése” a rendezés váltása után.
- `npm --prefix apps/web run typecheck`.

**Függőségek és kockázatok**
- A `name` index becsült mérete 50 MB körüli (a hasonló hosszú stringeket tartalmazó `dedupKey_1` 54 MB), a `salesStatus` indexé 7 MB körüli (mint a `call_1`). A cluster 5 GB-os keretéből ez belefér.
- `_id` nélkül az azonos értékű sorok sorrendjét az index belső sorrendje adja. Ez ugyanarra a lekérdezésre stabil, így a lapozás következetes; ha két lapozás között egy lead értéke megváltozik, egy sor oldalt válthat, ahogy ma is.
- Az `address` és a `phone` oszlopra nem kerül index. Ezek szerinti rendezés az „All leads” nézetben teljes scan marad; folder vagy projekt scope-ban a találati halmaz kicsi, ott gyors. Index csak akkor indokolt rájuk, ha a használat ezt igazolja (becsült méret együtt 100 MB fölött).
- Minden új index lassítja kissé a sync írásait; két kis index hatása elhanyagolható a meglévő 24 mellett.

#### 11. Sorok és darabszám szétválasztása

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | Sorok és darabszám szétválasztása | `app/api/leads/route.ts`, `lib/api.ts`, `components/Dashboard.tsx` | A sorok megvárják a `countDocuments`-et: keresésnél 52 ms helyett 5,2 s | Szűrés és keresés után a sorok azonnal megjelennek | 🟠 | S |

**Jelenlegi állapot**
- `app/api/leads/route.ts:88–91`: a `find` és a `countDocuments` egy `Promise.all`-ban fut, a válasz a lassabbikra vár. Üres szűrőnél `estimatedDocumentCount` fut (87. sor), az gyors.
- `Dashboard.tsx:397–412`: a kliens egy kérésből veszi a `rows` és a `total` értéket; lapozáskor és rendezésváltáskor a darabszám is újraszámolódik, pedig nem változik.
- `Dashboard.tsx:601–620`: a `stats` memo a `summaries`-ból már tartalmazza az aktuális scope összegeit (`total`, `noweb`, `hot`, `email`, `reviews`, `ai`), a típus, régió és ország szűrőt is figyelembe véve.

**Probléma**
- Mért `explain`: „No website” chip, sorok 7 ms, darabszám 581 ms. Keresés `pizza`: sorok 52 ms, darabszám 5 240 ms. Email „todo”: darabszám 3 483 ms.
- Ha nem javítjuk: minden szűrő- és keresőművelet annyi ideig tart, mint a darabszám, és minden lapozás újra kifizeti.

**Megoldás**
1. `route.ts` `GET`, két új, opcionális paraméter (az alap viselkedés és a `{ rows, total }` forma változatlan):
   - `total=0`: a `countDocuments` kimarad, a válasz `{ rows, total: -1 }`.
   - `only=total`: csak a darabszám fut, a válasz `{ total }`.
2. `lib/api.ts`: a `getLeads(q)` küldje a `total=0` paramétert; új `getLeadsTotal(q)` wrapper az `only=total` paraméterrel, a rendezés és lapozás paraméterei nélkül.
3. `Dashboard.tsx`: a mai effect csak a sorokat kéri. Új effect a darabszámra, amelynek a dependency listájában nincs `page`, `pageSize`, `sortKey` és `sortDir`. A `total` state `number | null`; `null` a számolás alatt.
4. Kliens oldali rövidítés: ha nincs keresőszó, kategória, `emailF`, `phoneF` és csoport-scope, a `hydrated` igaz, és a `filter` értéke `all`, `nowebsite`, `hot`, `email`, `hasreviews` vagy `hasai`, akkor a darabszám a `stats` memo megfelelő mezője (`total`, `noweb`, `hot`, `email`, `reviews`, `ai`), szerver kérés nélkül. A `haswebsite` chiphez nincs előre számolt érték, ott a szerver számol.
5. Lábléc (`Dashboard.tsx:1323`): `total === null` esetén `Counting…`. A lapozó: ismeretlen darabszámnál a „Page N” felirat látszik oldalszám nélkül, a „Next ›” akkor aktív, ha a betöltött sorok száma eléri az oldalméretet, a „»” inaktív.

**Elfogadási feltételek (acceptance criteria)**
- Keresésnél a sorok megjelennek, mielőtt a darabszám megérkezik; a lábléc közben `Counting…`.
- Lapozás és rendezésváltás nem indít darabszám kérést.
- A hat felsorolt chipnél, más szűrő nélkül, nincs `only=total` kérés, és a lábléc száma megegyezik a megfelelő csempével.
- A `total=0` és `only=total` nélküli `GET /api/leads` válasza ugyanaz, mint ma.

**Tesztelés**
- DevTools Network: chip váltás, keresés, lapozás, rendezés közben a kérések listája.
- Kézi összevetés: a „No website” chip lábléce és a „No website” csempe ugyanazt mutatja „All leads”, egy folder és egy típus-szűrő mellett.
- `npm --prefix apps/web run typecheck`.

**Függőségek és kockázatok**
- Az 5. feladat után érdemes, mert ugyanazt az effectet módosítja.
- A rövidítés a `ProjectStat` számlálóira épül, amelyek scrape közben a `/api/projects` cache frissüléséig késhetnek. A lábléc száma ilyenkor rövid ideig eltérhet a tényleges találatszámtól; a sorok mindig élő adatok.
- A 13. feladat ugyanezt a rövidítést kiterjeszti az email legördülő három értékére; a 14. feladat a keresés darabszámát gyorsítja fel.
- A 21. feladat után a `stats` a szerverről jön (`/api/sidebar/stats`); a rövidítés ugyanazokat a mezőket használja tovább.

#### 12. Index deklarációk rendbetétele és `checked` index

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | Index deklarációk rendbetétele és `checked` index | `lib/models.ts`, `docs/ARCHITECTURE.md` | A `checked` számlálás `COLLSCAN` (1,6 s); az alap nézetet kiszolgáló `gl_opp_sort` index nincs a kódban | Minden betöltésnél lefut; új adatbázison az alap nézet is lassú lenne | 🟠 | S |

**Jelenlegi állapot**
- `lib/models.ts:135–150`: a `LeadSchema` 15 indexet deklarál.
- Production-ön a `leads` collectionön 24 index van. A kódban nem szerepel: `gl_opp_sort { opportunityScore: -1, _id: 1 }` (29 MB), `gl_project_opp { project: 1, opportunityScore: -1, _id: 1 }` (27 MB), `emailCheckedAt_1` (9 MB), valamint a tokenleads négy indexe (`tl_leadscore_sort`, `tl_category_score`, `tl_websitestatus_score`, `tl_temperature_score`), amelyeket az `apps/tokenleads/scripts/source-indexes.mjs` hoz létre.
- `app/api/leads/route.ts:24`: `Lead.countDocuments({ checked: true })`, a `checked` mezőn nincs index.
- A `checked: true` szűrőt használja még a `route.ts:121` (`uncheckAll`), a `:179–181` (`allChecked` törlés) és a `app/api/groups/route.ts` `fromChecked` ága.

**Probléma**
- A `countChecked` kérés minden dashboard betöltésnél és minden `reloadKey` változásnál lefut: `COLLSCAN` 1 603 177 dokumentumon, 1,6 s a MongoDB-ben, 2,5–5,4 s production-ön. Ugyanez a `call` mezőre, ahol van index: 0 ms.
- Az alap nézet 66 ms-os ideje a `gl_opp_sort` indexen múlik, a folder nézeté a `gl_project_opp`-on. Mivel a kódban nincsenek, egy új vagy visszaállított adatbázisban (a PRD F8 szerint az export bundle üres adatbázisba importálható) nem jönnek létre, és az alap nézet teljes scanné válik.
- A 10. feladat két rendezése (`leadScore`, `category`) a tokenleads script által létrehozott indexekre támaszkodik.

**Megoldás**
1. `lib/models.ts`: vedd fel a `LeadSchema`-ra a már létező indexeket pontosan a production-beli kulcsokkal és névvel (azonos specifikációnál a Mongoose nem épít újra semmit):
   - `{ opportunityScore: -1, _id: 1 }`, `{ name: 'gl_opp_sort' }`
   - `{ project: 1, opportunityScore: -1, _id: 1 }`, `{ name: 'gl_project_opp' }`
   - `{ emailCheckedAt: 1 }`
   - `{ leadScore: -1, _id: 1 }`, `{ name: 'tl_leadscore_sort' }`
   - `{ category: 1, leadScore: -1 }`, `{ name: 'tl_category_score' }`
2. Új index: `{ checked: 1 }`. Előbb az Atlas UI-ban hozd létre, csúcsidőn kívül, utána deployold a deklarációt.
3. A meglévő deklarációk mellé kerüljön rövid komment arról, melyik nézet vagy rendezés támaszkodik rájuk (a fájl mai kommentstílusában).
4. `docs/ARCHITECTURE.md` §07: új bekezdés a `leads` indexek listájával és azzal, hogy a `tl_*` indexek közül kettőt a web is deklarál, mert a lead tábla rendezése használja őket.

**Elfogadási feltételek (acceptance criteria)**
- A `GET /api/leads?countChecked=1` production-ön 300 ms alatt válaszol (baseline: 2 548–5 388 ms).
- Az Atlas UI Explain Plan a `{ checked: true }` szűrőre indexet használ, a vizsgált dokumentumok száma 0 vagy a bejelölt leadek száma.
- Deploy után a `leads` collection indexlistája a `checked_1` kivételével nem változik (nincs duplikált vagy újraépített index), és a function logban nincs index konfliktus hiba.
- Az `Uncheck N` és a `Delete N` gomb, valamint a „Group N” (checked leadekből) változatlanul működik.

**Tesztelés**
- Függelék „Kérések mérése”: a `/api/leads [countChecked]` sor.
- Atlas UI → `leads` → Indexes: az indexek száma és neve deploy előtt és után.
- Kézi próba: három lead bejelölése, `Uncheck 3`.

**Függőségek és kockázatok**
- A 10. feladat előtt vagy vele együtt érdemes, mert az index deklarációk közös helyen vannak.
- Ha egy deklaráció kulcsa egyezik egy meglévő indexszel, de a neve eltér, a MongoDB hibát ad. Ezért szerepel fent minden név pontosan úgy, ahogy production-ön van.
- A `checked_1` becsült mérete 7 MB (mint a `call_1`).
- A `.claude/rules/database.md` szerint index változtatás jóváhagyást igényel; ezt a terv megrendelésekor megkaptuk („index + új cache adat”).
- A nem használt egymezős indexek (`opportunityScore_1`, `leadScore_1`: 2026-10-01 óta 0 használat) törlése nem része a feladatnak: együtt 18 MB, a nyereség elhanyagolható.

#### 13. Email szűrők indexelése

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | Email szűrők indexelése | `app/api/leads/route.ts`, `app/api/projects/route.ts`, `lib/models.ts` | „Email found” 2,0 s exec (production: 16,9 s), „website not checked yet” 13,3 s | Az outreach munkafolyamat fő szűrői | 🟡 | S |

**Jelenlegi állapot**
- `app/api/leads/route.ts:50`: az „Email found” chip szűrője `email: { $nin: ['', null] }`. Ugyanez a forma a 60. sorban (`emailCounts`) és a 67. sorban (`SET`).
- `route.ts:71`: az email legördülő „No email — website not checked yet” értéke: `{ email: EMPTY, websiteStatus: 'HAS_WEBSITE', emailCheckedAt: EMPTY }`.
- `app/api/projects/route.ts:65–66`: a payload tartalmazza az `email` és `emailMiss` számlálót, az `emailTodo`-t nem, pedig a `ProjectStat`-ban megvan (`lib/models.ts:114`).

**Probléma**
- „Email found”, sorok: a planner az `email_1` indexen mind a 79 430 emailes leadet beolvassa és memóriában rendezi: 2,0 s a MongoDB-ben; production-ön 16,9 s-ot mértünk.
- „Website not checked yet”, sorok: az `opportunityScore` szerinti bejárás 494 375 dokumentumot vizsgál, mire 50 találatot talál (a legmagasabb pontszámú leadeknek nincs weboldala): 13,3 s. A darabszám 1 108 857 dokumentumot olvas: 3,5 s. Production: 16,5 s.
- Ha nem javítjuk: az emailes leadek listázása és az audit előtt álló leadek áttekintése 15 s körül marad.

**Megoldás**
1. `route.ts`: az 50., 60. és 67. sorban a `{ $nin: ['', null] }` helyett `{ $gt: '' }`. String mezőn ez ugyanazt jelenti (nem üres string), és illeszkedik a 2. pont partial indexére. Az `EMPTY` (`$in: ['', null]`) változatlan.
2. `lib/models.ts`: új partial index az emailes leadekre: `{ opportunityScore: -1, _id: 1 }`, opciók `{ name: 'gl_email_opp', partialFilterExpression: { email: { $gt: '' } } }`. Kb. 79 ezer bejegyzés.
3. `lib/models.ts`: új index a „todo” szűrőre: `{ websiteStatus: 1, emailCheckedAt: 1, opportunityScore: -1, _id: 1 }`, `{ name: 'gl_todo_opp' }`. A `websiteStatus` egyenlőség és az `emailCheckedAt` két lehetséges értéke (`''`, `null`) mellett az index a találatokat `opportunityScore` sorrendben adja.
4. Mindkét indexet előbb az Atlas UI-ban hozd létre, majd az Explain Plan nézetben ellenőrizd a két lekérdezést. Ha a planner a „todo” szűrőre nem a `gl_todo_opp` indexet választja, a `route.ts` kapjon `.hint('gl_todo_opp')` hívást arra az esetre, amikor az `emailF === 'todo'` és nincs keresőszó, kategória és folder scope.
5. `app/api/projects/route.ts:65–66` és a 3. feladat payload formátuma: az `emailTodo` számláló kerüljön be 14. oszlopként; `lib/types.ts` `ProjectSummary`: `emailTodo?: number`.
6. `Dashboard.tsx`: a `stats` memo összegezze az `emailTodo`-t is, és a 11. feladat rövidítése bővüljön: ha az egyetlen aktív szűrő az `emailF`, akkor `has → email`, `miss → emailMiss`, `todo → emailTodo` adja a darabszámot szerver kérés nélkül.

**Elfogadási feltételek (acceptance criteria)**
- Az „Email found” chip sorai production-ön 1 s alatt megjelennek (baseline: 16,9 s), az Explain Plan `IXSCAN gl_email_opp`, legfeljebb oldalméretnyi vizsgált dokumentummal.
- Az „Email: No email — website not checked yet” sorai 1 s alatt megjelennek (baseline: 16,5 s), az Explain Plan nem tartalmaz 10 000-nél több vizsgált dokumentumot.
- A két szűrő találatszáma megegyezik a változtatás előttivel (79 430 és 944 728 a mérés napján, azóta a scrape-pel változhat; az összevetést ugyanabban az órában végezd).
- Az email csempe „have email” száma és az `emailCounts` válasz változatlan.

**Tesztelés**
- Atlas UI Explain Plan a két szűrőre az index létrehozása előtt és után.
- Kézi próba: chip és legördülő váltás „All leads”, egy folder és egy projekt scope-ban.
- `node --test apps/web/lib/projectsPayload.test.mjs` az új oszloppal.

**Függőségek és kockázatok**
- A 3. és a 11. feladat után készíthető el teljesen (payload oszlop, darabszám rövidítés); az 1–4. lépés önállóan is hasznos.
- A `gl_todo_opp` becsült mérete 30 MB körüli (a hasonló felépítésű `gl_project_opp` 27 MB), a `gl_email_opp` néhány MB.
- A partial indexet a planner csak akkor használhatja, ha a lekérdezés feltétele maga után vonja az index feltételét; ezért kötelező az 1. lépés `$gt: ''` formája.
- A `ProjectStat.emailTodo` alapértéke `null` („még nem számolt”); a payloadban ez 0-ként jelenik meg. Egy Σ Recount minden projektre kitölti.
- A „checked”, „miss” és „failed” legördülő értékek az `emailCheckedAt_1` indexen futnak tovább (legfeljebb 164 ezer dokumentum); ezekre nem kerül külön index.

#### 14. Szó eleji keresés `searchTokens` mezővel

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | Szó eleji keresés `searchTokens` mezővel | `lib/searchTokens.mjs` (új), `lib/models.ts`, `app/api/leads/route.ts`, `app/api/sync/route.ts`, `app/api/search-backfill/route.ts` (új) | A keresés 5 mezőn futó, horgonyzatlan regex: teljes scan, 5,2–7,5 s | A kereső a dashboard leggyakoribb művelete | 🟠 | M |

**Jelenlegi állapot**
- `app/api/leads/route.ts:79–82`: `new RegExp(escapeRegex(search), 'i')` a `name`, `category`, `address`, `phone`, `email` mezőkön `$or`-ral.
- Ugyanez a minta a `app/api/geo/route.ts:35–38` sorában.
- Horgonyzatlan, kis- és nagybetűt nem megkülönböztető regexet index nem tud kiszolgálni.

**Probléma**
- Mért `explain` a `pizza` szóra: a sorok 52 ms alatt megvannak (gyakori szó, az `opportunityScore` bejárás hamar talál 50-et), a darabszám viszont `COLLSCAN` 1 603 177 dokumentumon, 5,2 s. Ritka szónál a sorok lekérése is a teljes collectiont bejárja. Production: 7,5 s.
- Ha nem javítjuk: a kereső minden használata teljes scan, és az idő a leadszámmal együtt nő.

**Megoldás**
A döntés: a keresés szó eleji egyezésre vált (a `pizz` megtalálja a `Pizza Hut`-ot és a `Joe's Pizza`-t, a `zza` nem), új mezővel és egyszeri backfill-lel.

1. **Tokenizáló.** Új `lib/searchTokens.mjs`, tiszta függvényekkel:
   - `normalize(s)`: kisbetű, `NFD` bontás után az ékezetek eltávolítása;
   - `tokensOf({ name, category, address, phone, email })`: a `name`, `category`, `address` szavai (vágás minden nem betű és nem szám karakternél); a telefonszám számjegycsoportjai és az összes számjegy egyben; az email teljes kisbetűs alakja és a nem alfanumerikus karaktereknél vágott részei. Az 1 karakteres tokenek kimaradnak, a lista ismétlődés nélküli, legfeljebb 24 elem;
   - `queryWords(term)`: a keresőszó ugyanígy normalizálva és szavakra vágva, a 2 karakternél rövidebb szavak nélkül.
2. **Modell.** `lib/models.ts` `LeadSchema`: `searchTokens: { type: [String], default: undefined }` és `LeadSchema.index({ searchTokens: 1 })`.
3. **Írási utak.** Új szerver segédfüggvény `lib/searchIndex.ts` `refreshSearchTokens(keys: { project: string; dedupKey: string }[])`: beolvassa az öt mezőt, és `bulkWrite`-tal beírja a tokeneket. Hívások:
   - `app/api/sync/route.ts`: a `Lead.bulkWrite` (110. sor) után a batch minden érintett leadjére. Így a „üres mező nem írja felül a tárolt értéket” szabály után, a tényleges tárolt értékekből számol;
   - `app/api/leads/route.ts` `POST` (111. sor után) és `PATCH` (163. sor után, ha a módosított mező `name`, `category`, `phone`, `email` vagy `address`);
   - `app/api/lead-search/route.ts` és `app/api/audit/route.ts`: az email mentése után.
4. **Backfill.** Új `app/api/search-backfill/route.ts`, `POST { after? }`, a `app/api/recalc/route.ts` mintájára: `_id` szerint 5 000 leadet dolgoz fel kérésenként, a válasz `{ ok, processed, lastId, done }`. `runtime = 'nodejs'`, `maxDuration = 60`, `OPTIONS` export, `try/catch`. Új wrapper: `api.backfillSearchTokens(after)`. A route alapból bejelentkezéshez kötött (nem kerül az `OPEN_API` listába).
5. **Méret ellenőrzés a backfill elején.** Az első 100 000 lead után állj meg, és az Atlas UI-ban (`leads` → Indexes) olvasd le a `searchTokens_1` index méretét. Szorozd 16-tal. Csak akkor folytasd, ha a cluster teljes becsült foglalása így 4 GB alatt marad. Ha nem, a `tokensOf` hagyja ki az `address` szavait, és a backfill induljon újra.
6. **Lekérdezés átállítása** (külön deploy, a backfill befejezése után). `route.ts:79–82`: `const words = queryWords(search)`; ha van szó: `match.$and` bővül szavanként egy `{ searchTokens: { $gte: w, $lt: w + '￿' } }` feltétellel. Ha a keresőszóból nem marad szó (pl. egyetlen karakter), a szűrő nem alkalmazódik. Ugyanez a csere a `geo/route.ts:35–38` sorában.
7. **Export.** `app/api/export/route.ts:39`: a `searchTokens` mező maradjon ki a bundle-ből (`const { _id, searchTokens, ...r }`); importkor a sync újraszámolja.
8. **Docs.** `docs/ARCHITECTURE.md` §06: új pont a `searchTokens` mezőről és arról, hogy a keresés szó eleji. `apps/web/README.md` „Data — MongoDB” szakasz: az új mező. A kereső placeholder szövege (`Dashboard.tsx:1123`) változatlan.

**Elfogadási feltételek (acceptance criteria)**
- Keresés `pizza` szóra az „All leads” nézetben: a sorok és a darabszám is 1 s alatt megérkezik production-ön (baseline: 7,5 s).
- Az Atlas UI Explain Plan a keresésre `IXSCAN searchTokens_1`, `COLLSCAN` nélkül.
- Találat van: szó elejére (`pizz`), több szóra tetszőleges sorrendben (`hut pizza`), ékezet nélküli alakra (`becs` → `Bécs`), telefonszám részletre (`205 555`), email domainre (`gmail`).
- Nincs találat szó belsejére (`zza`). Ez tudatos viselkedésváltozás.
- A backfill után `db.leads.countDocuments({ searchTokens: { $exists: false } })` értéke 0.
- Egy újonnan szinkronizált és egy kézzel átnevezett lead az új nevére azonnal kereshető.
- `node --test apps/web/lib/searchTokens.test.mjs` zöld.

**Tesztelés**
- Unit teszt a `tokensOf` és `queryWords` függvényre: ékezetek, írásjelek, telefonszám formátumok, email, üres mezők, a 24 elemes korlát.
- A backfill indítása a dashboardon, bejelentkezve, a böngésző konzoljából:
  ```js
  let after = null;
  for (;;) {
    const r = await (await fetch('/api/search-backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ after }) })).json();
    if (!r.ok) throw new Error(r.error);
    console.log(r.processed, r.lastId);
    if (r.done) break;
    after = r.lastId;
  }
  ```
- Kézi próba az elfogadási feltételek keresőszavaival, a Leads és a Map nézetben.

**Függőségek és kockázatok**
- A 11. feladat után a keresés darabszáma már nem blokkolja a sorokat; ez a feladat magát a darabszámot és a ritka szavak keresését gyorsítja.
- Sorrend: előbb az írási utak és a backfill route deployja, utána a backfill futtatása, és csak a végén a lekérdezés átállítása. Fordított sorrendben a kereső a még tokenizálatlan leadeket nem találná meg.
- A backfill mind az 1,6 M leadet módosítja a production adatbázisban (321 kérés). Ez az ARCHITECTURE.md §08 szerinti tömeges módosítás; a jóváhagyás a terv megrendelésekor megvolt („új mező + backfill”). Csúcsidőn kívül futtasd, scrape közben ne.
- Tárhely becslés: leadenként kb. 12 token, azaz kb. 19 millió indexbejegyzés, nagyságrendileg 0,5 GB index és 0,25 GB adat. A cluster jelenleg 1,9 GB adat + 0,5 GB index az 5 GB-ból. A becslés bizonytalan, ezért kötelező az 5. lépés mérése.
- A sync kérésenként egy további olvasást és egy `bulkWrite`-ot kap (legfeljebb 500 lead); a streamelt scrape sebességére ennek nincs érdemi hatása.
- Az `apps/landing/lib/models.ts` tükörmodell nem használja az új mezőt, nem kell módosítani. A tokenleads csak olvassa a collectiont, az új mező nem zavarja.
- A Notes nézet keresője (`app/api/notes/route.ts`) a jegyzettel rendelkező leadekre szűkít, kis halmazon fut; ott a regex marad.

### E. Többi nézet

A Groups, Notes, Calls, Changelog és Categories nézet lekérdezései a MongoDB-ben gyorsak (0,3–1,7 s production-ön, ebből a nagyobb rész régió és hideg indulás). Ezekhez nem tartozik külön feladat; az 1. feladat után újra kell mérni őket.

#### 15. Stats nézet: metrikák `ProjectStat`-ból, bucket cache

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | Stats nézet: metrikák `ProjectStat`-ból, bucket cache | `app/api/stats/route.ts`, `lib/cache.ts` | Két teljes `$group` az összes leaden: 11,4 s | A Stats nézet megnyitása ma 11 s | 🟠 | S |

**Jelenlegi állapot**
- `app/api/stats/route.ts:30–51`: két aggregáció fut párhuzamosan a `leads` collectionön. Az első a `scrapedAt` első 10 vagy 13 karaktere szerint csoportosít (napi vagy órás bucketek), a második ugyanazt a nyolc metrikát számolja, amit a `ProjectStat` már tartalmaz (`lib/projectStats.ts:6–29`).
- `components/StatsModal.tsx:90–98`: a nézet megnyitáskor az „All leads” scope-pal kér, és minden scope vagy granularitás váltásnál újra.

**Probléma**
- Mérés az összes leadre: production 11,4 s. A MongoDB-ben a bucketek 3,4 s, a metrikák 1,9 s. Ugyanezek a metrikák a `projectstats` collection összegzésével 0,7 s alatt megvannak, azonos eredménnyel (`total` 1 603 177, `oppSum` 34 981 479 mindkét úton).
- A bucket aggregáció a `scrapedAt_1` indexre szűkítve is 3,0 s, tehát indexszel nem gyorsítható érdemben.
- Ha nem javítjuk: a Stats nézet minden megnyitása két teljes collection scan, ami a `.claude/rules/database.md` szabályát is sérti.

**Megoldás**
1. Metrikák: a második aggregáció (`route.ts:37–50`) helyett `ProjectStat.aggregate([{ $match: scope }, { $group: { _id: null, total: { $sum: '$total' }, noWebsite: { $sum: '$noWebsite' }, hot: { $sum: '$hot' }, email: { $sum: '$email' }, reviews: { $sum: '$reviews' }, reviewsSum: { $sum: '$reviewsSum' }, ai: { $sum: '$ai' }, oppSum: { $sum: '$oppSum' } } }])`. A `scope` ugyanaz a `{ project: … }` szűrő, mert a `ProjectStat` kulcsa is `project`. Az `avgOpp` számítása változatlan.
2. Bucketek, scope nélkül: az eredmény a `lib/cache.ts` (2. feladat) segítségével a `caches` collectionbe kerül `stats:day` és `stats:hour` kulccsal, a `data` mezőben, 10 perces TTL-lel. Lejárt cache esetén a régi adat megy ki azonnal, a rebuild `after()`-ben fut. Ha még nincs cache, az első kérés a kérésen belül számol.
3. Bucketek, folder vagy projekt scope-pal: élő aggregáció, ahogy ma (a `project` index szűkíti).
4. A bucket aggregáció szűrője `scrapedAt: { $nin: [null, ''] }` helyett `scrapedAt: { $gt: '' }` legyen.
5. A válasz formája (`{ buckets, gran, total, metrics }`) nem változik, a `StatsModal.tsx` nem módosul.

**Elfogadási feltételek (acceptance criteria)**
- A Stats nézet „All leads” scope-on, meleg cache mellett 500 ms alatt kap választ production-ön (baseline: 11,4 s).
- A Stats nézet metrikái megegyeznek a Leads nézet csempéivel ugyanarra a scope-ra.
- A napi bucketek összege megegyezik a változtatás előttivel (a mérés napján 48 bucket).
- Folder scope-on a válasz 2 s alatt megérkezik (baseline: 6,7 s egy 17 481 leades folderre).

**Tesztelés**
- Függelék „Kérések mérése” a Stats nézet megnyitása után, kétszer egymás után (hideg és meleg cache).
- Kézi összevetés: csempék és Stats metrikák „All leads”-re és egy folderre.
- Day és hour granularitás váltása.

**Függőségek és kockázatok**
- A 2. feladat `lib/cache.ts` modulja kell hozzá.
- A metrikák a `ProjectStat` frissességét követik. Minden írási út frissíti az érintett projektet (`recomputeProjectStats`), így az eltérés csak hibás számláló esetén lép fel; arra a Σ Recount szolgál.
- A grafikon „All leads” scope-on legfeljebb 10 percet késhet a tényleges állapothoz képest.

#### 16. Map: karcsú pont payload és `applyProjectScope`

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | Map: karcsú pont payload és `applyProjectScope` | `app/api/geo/route.ts`, `components/MapModal.tsx`, `lib/api.ts`, `lib/models.ts` | 359 byte pontonként (200 000 pont = 71,8 MB, 22 s); a típus/régió szűrő regexet futtat az 1,6 M leaden | Széles scope-nál a Map használhatatlan | 🟠 | M |

**Jelenlegi állapot**
- `app/api/geo/route.ts:8`: `CAP = 200000`. A 40–43. sor előbb megszámolja a találatokat, utána lekéri a pontokat 12 mezővel (`lat`, `lng`, `name`, `category`, `rating`, `reviewCount`, `phone`, `website`, `websiteStatus`, `mapsUrl`, `opportunityScore`, `leadTemperature`).
- `route.ts:30`: a típus és régió szűrőt az `applyProjectFacets()` (`lib/models.ts:198–217`) alkalmazza, ami scope nélkül regexet tesz a `project` mezőre. A `lib/projectScope.ts` fejléce szerint ez a minta 15–45 s az 1,6 M leaden; a leads route már az `applyProjectScope()`-ra váltott, a geo route nem.
- `components/MapModal.tsx:99`: a `projectList` memo a teljes `summaries`-t rendezi `localeCompare`-rel. A 260–272. sor `scopePicker` eleme minden projektre létrehoz egy `<option>`-t; az inline nézet ezt ki is rendereli (280. sor). Production-ön ez 241 968 `<option>`.
- `MapModal.tsx:186–250`: minden pontra `circleMarker` és `bindPopup(popupHtml(p))` készül.
- A nézet scope nélkül nem kér pontokat (`eff.none`, 192–196. sor).

**Probléma**
- Mérés: levél folder (17 481 pont) 6,1 MB és 3,3 s; szűrő nélküli scope 200 000 pont, 71,8 MB és 22,0 s. A pontok mérete 359 byte, ennek nagy része csak a popupban jelenik meg, kattintás után.
- A `countDocuments` a `lat` / `lng` feltétellel scope nélkül `COLLSCAN` (2,4 s), és a pontok lekérése előtt, sorosan fut.
- A Map nézet megnyitása 241 968 `<option>` elemet hoz létre, és a nézet minden state változása újrarendereli őket.
- Ha nem javítjuk: országos vagy típus szintű térkép 20 s fölött tölt, több tíz MB-ot mozgat, és a nézet a projektszámmal együtt lassul.

**Megoldás**
1. **Pont formátum.** `route.ts`: a lekérés csak a `lat`, `lng`, `websiteStatus`, `dedupKey` mezőt kérje. A válasz: `{ cols: ['lat', 'lng', 'noSite', 'key'], points: [[lat, lng, 0 | 1, dedupKey], …], total, capped }`. A koordináták 5 tizedesre kerekítve (kb. 1 m pontosság); a `noSite` a `NO_SITE` lista alapján a szerveren dől el.
2. **Popup adat kattintásra.** `app/api/leads/route.ts` `GET`: új `key` paraméter, ami egyetlen leadet ad vissza `dedupKey` alapján (`dedupKey_1` index), a `{ rows, total }` formában. Új wrapper: `api.getLeadByKey(key)`. `MapModal.tsx`: a markerek `key` opciót kapnak popup nélkül; a cluster réteg `click` eseménye lekéri a leadet, és a meglévő `popupHtml()`-lel (az `esc()` megtartásával) nyit popupot; a betöltés alatt `Loading…` áll benne.
3. **Számlálás.** A `countDocuments` és a `find` fusson `Promise.all`-ban.
4. **Scope szűrő.** `route.ts:30`: `applyProjectFacets(…)` helyett `await applyProjectScope(match, ptypes, pregions, country)`, ahogy a `app/api/leads/route.ts:55`. A route fogadja a `country` paramétert; a `lib/api.ts` `getGeo` paraméterlistája bővül vele, és a `MapModal.tsx` átadja a cascade `cas.country` értékét, ha van típus, de nincs állam vagy város kiválasztva.
5. **Holt kód.** `lib/models.ts:198–217`: az `applyProjectFacets()` törlése, mert a geo route volt az utolsó hívója.
6. **Scope választó.** `MapModal.tsx:99` és `:268–270`: a `projectList` memo és a „Projects” `<optgroup>` megszűnik. A választó az „All leads” és a folderek mellett csak az éppen aktív projektet tartalmazza, ha a scope projekt. Projektet a sidebarból lehet választani.
7. `lib/api.ts:44–49`: a `GeoPoint` típus az új formátumot írja le.

**Elfogadási feltételek (acceptance criteria)**
- 17 481 pontos folder: a `/api/geo` válasz kitömörítve 1,5 MB alatt van (baseline: 6,1 MB).
- 200 000 pontos scope: a válasz 15 MB alatt van (baseline: 71,8 MB).
- Típus szűrő (pl. egy business type, ország nélkül) mellett a `/api/geo` nem tartalmaz regexet a `project` mezőn (Atlas UI Explain Plan vagy a route kódja alapján `$in` / `$nin` lista).
- Markerre kattintva a popup ugyanazokat a mezőket mutatja, mint ma, és az „Open in CRM” gomb működik.
- A Map nézet megnyitása után a `<select class="map-select">` `<option>` elemeinek száma legfeljebb a folderek száma + 2.
- A piros/zöld színezés (no website / has site) megegyezik a változtatás előttivel.

**Tesztelés**
- Függelék „Kérések mérése” a Map nézetben egy levél folderre és egy típus szűrőre.
- Kézi próba: marker popup, cluster szétnyitás, „Open in CRM”, város kiemelés (Nominatim).
- `document.querySelectorAll('.map-select option').length` a konzolban.

**Függőségek és kockázatok**
- A 14. feladat ugyanebben a fájlban a keresőszűrőt cseréli; a két módosítás független, de egy fájlt érint.
- A popup tartalma kattintásonként egy kérés (az 1. feladat után 100 ms körül); offline vagy hiba esetén a popupban ez álljon: `Could not load details.`
- A `CAP` értéke (200 000) nem változik; a kisebb pontméret miatt ugyanennyi pont töredék adatot jelent. A 200 000 marker kliens oldali felépítése (Leaflet markercluster, `chunkedLoading`) továbbra is másodpercekig tart; ez a feladat a hálózati és szerver oldali részt javítja.
- A scope választóból eltűnik a projektek listája. 241 968 elemnél a lista eddig sem volt használható; a sidebar szűrője erre alkalmasabb.

#### 17. Reviews nézet: `scrapedAt` index és gyors számlálás

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | Reviews nézet: `scrapedAt` index és gyors számlálás | `app/api/reviews/list/route.ts`, `lib/models.ts`, `lib/projectScope.ts` | Az 1. oldal `SORT ← COLLSCAN` 549 729 dokumentumon: 4,2 s exec, 5,4 s production | A Reviews nézet megnyitása ma 5 s | 🟠 | S |

**Jelenlegi állapot**
- `app/api/reviews/list/route.ts:42–45`: `Review.find(match).sort({ scrapedAt: -1, _id: -1 })` és `Review.countDocuments(match)` párhuzamosan.
- `lib/models.ts:152–156`: a `reviews` collection indexei: `dedupKey_1`, `project_1_dedupKey_1`, `dedupKey_1_reviewId_1`. A `scrapedAt` mezőn nincs index.
- `route.ts:32–37`: az ország, állam és város szűrő regex a `project` mezőn.
- A handlerben nincs `try/catch` (az ARCHITECTURE.md §04 fel is sorolja).

**Probléma**
- Mért `explain` az 1. oldalra: `SORT ← COLLSCAN`, 549 729 vizsgált dokumentum, 4,2 s. Az üres szűrős `countDocuments` aggregációként fut, a collection metaadatából viszont 0 ms alatt megvan a szám.
- Az állam vagy ország szűrő a regex miatt végigolvassa a collectiont.
- Ha nem javítjuk: a Reviews nézet megnyitása 5 s körül marad, és a review-k számával nő.

**Megoldás**
1. `lib/models.ts`: `ReviewSchema.index({ scrapedAt: -1, _id: -1 })`. Előbb az Atlas UI-ban hozd létre.
2. `route.ts:44`: üres `match` esetén `Review.estimatedDocumentCount()`, különben `Review.countDocuments(match)` (ugyanaz a minta, mint a `app/api/leads/route.ts:87–91`).
3. `lib/projectScope.ts`: új named export `projectNamesWhere(test: (q: string) => boolean)`, ami a meglévő, 3 percig cache-elt `projectNames()` listát szűri memóriában.
4. `route.ts:32–37`: a három regexet ne a MongoDB kapja, hanem a `projectNamesWhere()`; az eredmény `match.project = { $in: names }`. Ha a lista 40 000 névnél hosszabb (a `projectScope.ts` `LIST_MAX` értéke), marad a regex.
5. A teljes handler kerüljön `try/catch`-be; hiba esetén `json({ ok: false, rows: [], total: 0, error }, { status: 500 })`.

**Elfogadási feltételek (acceptance criteria)**
- A Reviews nézet 1. oldala production-ön 1 s alatt megérkezik (baseline: 5,4 s).
- Az Atlas UI Explain Plan a `reviews` collectionön `{}` szűrővel és `{ scrapedAt: -1, _id: -1 }` rendezéssel `IXSCAN`, `SORT` szakasz nélkül.
- Az állam szűrő (pl. Texas) találatszáma megegyezik a változtatás előttivel.
- Hibás adatbázis kapcsolat esetén a route `{ ok: false, error }` választ ad 500-as státusszal, nem üres 500-at.

**Tesztelés**
- Függelék „Kérések mérése” a Reviews nézet megnyitása után.
- Kézi próba: ország, állam, város szűrő, business autocomplete, lapozás.

**Függőségek és kockázatok**
- Nincs előfeltétele.
- Az új index becsült mérete 15 MB alatti (a `leads` hasonló `scrapedAt_1` indexe 10 MB háromszor annyi dokumentumra).
- A review szöveg és szerző keresője (`route.ts:39`) horgonyzatlan regex marad a 340 MB-os collectionön. Ez a feladat nem érinti; ha a használat indokolja, a 14. feladat mintája alkalmazható rá.
- A T-010 (try/catch a felsorolt route-okban) ezzel a route-tal részben teljesül.

#### 18. Duplicates: darabolt, cache-elt újraírás

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 18 | Duplicates: darabolt, cache-elt újraírás | `app/api/duplicates/route.ts`, `components/DuplicatesModal.tsx`, `lib/api.ts`, `lib/models.ts` | Egyetlen `$group` az összes leaden túllépi a memória limitet: HTTP 500 | A funkció production-ön nem működik | 🟠 | M |

**Jelenlegi állapot**
- `app/api/duplicates/route.ts:9–30`: egyetlen aggregáció a teljes `leads` collectionön: azonosító kulcs képzése (`cid`, ennek híján `placeId`, ennek híján a kisbetűs név), `$group` `$push`-sal, majd a több elemű csoportok. Nincs `try/catch`, nincs `maxDuration`.
- `components/DuplicatesModal.tsx:18–26`: a modal megnyitáskor egyszer hívja az `api.getDuplicates()`-t, a hibát üres listává alakítja.
- A lead azonosítója: `dedupKey = placeId || cid || name|lat|lng` (`apps/extension/lib/mapsParser.js:70`).

**Probléma**
- Production-ön a route 1,3 s után üres body-jú HTTP 500-at ad: az 1,6 M csoportos `$group` túllépi a megosztott tier 100 MB-os aggregációs memória limitjét. A modal ilyenkor azt mutatja, hogy nincs duplikátum.
- Mérés a tervhez: a `dedupKey_1` indexen 100 000 kulcsos szeletekben végigmenve (17 szelet, összesen 11 s, a leglassabb szelet 0,5 s) egyetlen ismétlődő `dedupKey` sincs. 1 603 177 leadből 1 603 176-nak van `cid` értéke. Duplikátum tehát csak úgy létezhet, hogy ugyanaz a `cid` két különböző `dedupKey` alatt szerepel (egyszer `placeId`, egyszer `cid` alapú kulccsal).
- Ha nem javítjuk: a funkció csendben hibás marad, és a felhasználó azt hiszi, nincs duplikátum.

**Megoldás**
1. `lib/models.ts`: új index `LeadSchema.index({ cid: 1 })`. Előbb az Atlas UI-ban hozd létre.
2. `route.ts`, a `app/api/categories/summary/route.ts` mintájára (`GET` cache-ből, `POST` darabonként, a kliens hajtja):
   - `GET` → `{ ok, groups, total, at }` a `caches` collection `duplicates` dokumentumából; ha nincs, `{ ok: true, groups: [], total: 0, at: 0 }`.
   - `POST { after?, at? }` → egy szelet. A szelet felső határa a `cid_1` indexen `skip(99 999).limit(1)` lekérdezéssel; a szeleten `[{ $match: { cid: range } }, { $group: { _id: '$cid', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]` a `cid_1` indexre hintelve. A talált `cid`-kre `Lead.find({ cid: { $in } })` a modalnak kellő mezőkkel (`project`, `dedupKey`, `name`, `address`, `category`, `rating`, `reviewCount`, `checked`). A részeredmény a `duplicates_partial` dokumentumba gyűlik; 2 000 csoport fölött (a mai `$limit` értéke) csak a `total` nő tovább. Az utolsó szelet után az eredmény a `duplicates` dokumentumba kerül, `count` szerint csökkenő, név szerint növekvő sorrendben. Válasz: `{ ok, done, after, at }`.
   - Az üres `cid` kimarad (`cid: { $gt: '' }`). A `placeId` és a név szerinti tartalék ág megszűnik.
   - `runtime`, `maxDuration = 60`, `OPTIONS`, `try/catch` a többi route mintájára.
3. `lib/api.ts`: `getDuplicates()` az új `GET` formára, új `scanDuplicates({ after, at })` wrapper.
4. `DuplicatesModal.tsx`:
   - megnyitáskor `GET`; ha `at === 0`, automatikusan indul a keresés;
   - új `Rescan` gomb és folyamatjelző a `CategoriesView.tsx:37–52` ciklusának mintájára;
   - a fejléc mutatja a keresés idejét (`Scanned <dátum>`) és a `total` értéket, ha az nagyobb a megjelenített 2 000-nél;
   - törlés után (`del`, 43–48. sor) a törölt elemek a helyi listából kerülnek ki, nem indul új keresés;
   - a `GET` hibája külön hibaüzenetet ad (`Could not load duplicates.`), nem üres listát.
5. `docs/ARCHITECTURE.md` §04 „Long jobs”: a `duplicates` kerüljön a kliens által hajtott, darabolt feladatok felsorolásába; a §04 „Errors” bekezdés `try/catch` nélküli listájából a `duplicates` törlendő.

**Elfogadási feltételek (acceptance criteria)**
- A `GET /api/duplicates` 200-at ad `{ ok: true, … }` formában (baseline: HTTP 500).
- A teljes keresés egyetlen kérése sem lépi túl a 10 s-ot, és a teljes kör 60 s alatt lefut.
- Egy ellenőrzött esetben (két lead azonos `cid`-del, eltérő `dedupKey`-jel; ha production-ön nincs ilyen, a keresés 0 csoportot ad, és ez a helyes eredmény) a modal egy csoportot mutat két elemmel.
- A „Fix group”, „Fix all” és a kijelöltek törlése után a törölt elemek eltűnnek a listából, és a sidebar számai frissülnek.
- Szerverhiba esetén a modal hibaüzenetet mutat.

**Tesztelés**
- Kézi próba: modal megnyitása üres cache-sel (automatikus keresés), `Rescan`, bezárás és újranyitás (cache-ből tölt).
- Függelék „Kérések mérése” a keresés alatt: a `/api/duplicates` kérések ideje.
- Atlas UI Explain Plan egy szelet aggregációjára: `IXSCAN cid_1`, dokumentum olvasás nélkül.

**Függőségek és kockázatok**
- A 2. feladat `lib/cache.ts` modulja használható az olvasáshoz és íráshoz.
- A `cid_1` index becsült mérete 50 MB körüli (a `dedupKey_1` 54 MB).
- Viselkedésváltozás: a név szerinti egyezés megszűnik. Ez az ág csak `cid` és `placeId` nélküli leadekre futott, ilyen production-ön egy van.
- A törlés adatvesztéssel jár (a modal ma is így működik, megerősítés után). A logika nem változik: a csoport utolsó eleme marad meg.
- A cache a keresés pillanatát tükrözi; új sync után a `Rescan` gomb frissíti.

### F. Lazy sidebar (2. fázis)

A B és C csoport után a megnyitás gyors, de a kliens továbbra is letölti és memóriában tartja mind a 241 968 projektet, tehát az idő a projektszámmal együtt nő. Ez a csoport megszünteti ezt: induláskor csak a folderek és a folder szintű összesítők érkeznek, a projektek folderenként, kinyitáskor.

#### 19. Szerver: folder szintű összesítők, `GET /api/sidebar`

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | Szerver: folder szintű összesítők, `GET /api/sidebar` | `app/api/sidebar/route.ts` (új), `lib/sidebar.ts` (új), `lib/projectStats.ts`, `lib/api.ts` | A sidebar számaihoz ma mind a 241 968 projektet le kell tölteni | A payload a projektszámmal lineárisan nő; ez szünteti meg | 🟠 | M |

**Jelenlegi állapot**
- A folder badge-eket (`totalOf`, `projCountOf`, `zeroCountOf`), a hat csempét, a típus, régió és ország legördülők opcióit a kliens számolja a teljes projektlistából (`Dashboard.tsx:420–435`, `438–527`, `601–620`).
- Folder szintű összesítő nincs sem a `Folder`, sem a `ProjectStat` modellben.

**Probléma**
- A megjelenítéshez 774 folder összesítője kellene, a kliens mégis 241 968 sort kap (a 3. feladat után is 20 MB fölötti JSON).
- Mérés: a MongoDB-n belüli `projectstats $lookup projects $group folderId` 25,9 s, tehát az összesítőt nem lehet kérésenként, joinnal számolni. A két collection külön kiolvasása 4,7 s + 3,5 s (a clustertől 21 ms-ra), ez cache mögé való.
- Ha nem javítjuk: a 21. feladat nem készíthető el.

**Megoldás**
1. Új `lib/sidebar.ts` (szerver modul) `buildSidebarAggregates()` függvénnyel. A `computeProjects()` (`app/api/projects/route.ts:53–69`) eredményéből egy menetben számolja:
   - folderenként a saját (nem rekurzív) projektek összesítőjét: `projects`, `zero` (0 leades projektek), `total`, `noWebsite`, `hot`, `email`, `emailMiss`, `emailTodo`, `reviews`, `reviewsSum`, `ai`, `oppSum`;
   - ugyanezt a mappa nélküli projektekre (`ungrouped`) és a teljes összegre (`all`);
   - a szűrő opciókat darabszámmal: `types` (a `parseProject()` szerint, ami a `app/api/projectfacets/route.ts:13–25` exportja), `regions` és `countries` (a `parseProjectGeo()` szerint).
2. Cache: a `lib/cache.ts` (2. feladat) `sidebar` kulcsa, 120 s TTL, tartalom hash, stale kiszolgálás és `after()` rebuild, ugyanazzal a logikával, mint a projects payloadnál.
3. `lib/projectStats.ts:33–36` `invalidateProjectsCache()`: a `projects` mellett a `sidebar` kulcsot is törölje. Így minden mai hívási hely (projekt rename/move/delete, folder törlés, Organize, Recount) ezt is érvényteleníti.
4. Új `app/api/sidebar/route.ts`, `GET`: a folderek élő lekérdezése (`Folder.find()`, 774 dokumentum) összefésülve a cache-elt összesítőkkel. Válasz: `{ ok, at, folders: [{ id, name, createdAt, collapsed, order, parentId, icon, own: {…} }], ungrouped: {…}, all: {…}, facets: { types, regions, countries } }`. `ETag` a teljes válasz hash-éből, `Cache-Control: private, no-cache`, 304 egyezésnél. `runtime`, `maxDuration = 60`, `OPTIONS`, `try/catch`.
5. `lib/api.ts`: `getSidebar()` wrapper és a válasz típusa a `lib/types.ts`-ben (`SidebarPayload`, `FolderAggregate`).
6. `lib/sidebar.test.mjs` nem készül, mert a modul szerver függőségű; a tiszta összegző rész kerüljön `lib/sidebarAggregate.mjs`-be `node:test` teszttel (üres lista, mappa nélküli projekt, nem létező folderre mutató `folderId`, 0 leades projekt).
7. `docs/ARCHITECTURE.md` §03 (új endpoint), §06 (a `/api/projects` payload döntés mellé: a sidebar összesítő cache), `apps/web/README.md` „API” szakasz.

**Elfogadási feltételek (acceptance criteria)**
- A `GET /api/sidebar` válasza kitömörítve 1 MB alatt van, és meleg cache mellett 300 ms alatt megérkezik production-ön.
- Minden folderre: a `own` összesítők rekurzív összege megegyezik a mai sidebar badge-ekkel (`totalOf`, `projCountOf`, `zeroCountOf`), öt kiválasztott folderen kézzel ellenőrizve.
- Az `all` összesítő megegyezik a hat csempe „All leads” értékével.
- A `facets.countries` megegyezik a mai ország legördülő tartalmával.
- Folder átnevezése, áthelyezése és ikonváltása a következő `GET`-ben azonnal látszik (a folderek élő adatok).
- Változatlan adatnál a második kérés 304.

**Tesztelés**
- `node --test apps/web/lib/sidebarAggregate.test.mjs`.
- Kézi összevetés a mai sidebarral (a régi és az új út a 21. feladatig egymás mellett él).
- Függelék „Kérések mérése” snippetje egy kézi `fetch('/api/sidebar')` után.

**Függőségek és kockázatok**
- A 2. feladat (`lib/cache.ts`) és a 6. feladat (gyors `parseProjectGeo`, mert a szerver 241 968 nevet dolgoz fel a rebuildnél) kell előtte.
- Az új endpoint alapból bejelentkezéshez kötött, nem kerül az `OPEN_API` listába.
- A rebuild ugyanazt a két teljes kiolvasást végzi, mint ma a projects payload; a 21. feladatig mindkét cache él, utána a `projects` kulcs megszűnik.
- Új collection és új modellmező nem kell: az összesítők a meglévő `caches` collectionbe kerülnek.

#### 20. Szerver: projektek folderenként, projekt keresés, scope-olt csempék

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | Szerver: projektek folderenként, projekt keresés, scope-olt csempék | `app/api/projects/route.ts`, `app/api/sidebar/stats/route.ts` (új), `lib/projectScope.ts`, `lib/api.ts` | Nincs endpoint egy folder projektjeire, a sidebar szűrőre és a szűrt csempékre | A 21. feladat előfeltétele | 🟠 | M |

**Jelenlegi állapot**
- A `GET /api/projects` (`route.ts:76–95`) paraméter nélkül az összes projektet adja.
- A sidebar szöveges és típus/régió/ország szűrője a kliensen fut a teljes listán (`Dashboard.tsx:568–598`), a csempék szűrt összege is (`Dashboard.tsx:601–620`).
- `lib/projectScope.ts:13–20`: a szerveren már van 3 percig cache-elt lista az összes projektnévről.

**Probléma**
- A lazy betöltéshez három dolog kell a szervertől, ami ma nincs: egy folder projektjei, a szűrőnek megfelelő projektek, és a szűrt scope összesítői.
- Mérés a megvalósíthatósághoz: egy folder projektjei a `folderId_1` indexen 71 ms (384 projekt), a mappa nélküliek 251 ms (8 470 projekt), szöveges keresés a 241 968 projekt nevében 0,4 s.

**Megoldás**
1. `app/api/projects/route.ts` `GET`, új paraméterek (paraméter nélkül a mai viselkedés marad a 21. feladatig):
   - `?folder=<id>`: a folder közvetlen projektjei; `?folder=__root__`: a mappa nélküliek. `Project.find({ folderId })`, majd `ProjectStat.find({ project: { $in } })`, a válasz a 3. feladat kompakt formátumában. Nincs cache, élő adat.
   - `?folder=<id>&deep=1&fields=names`: a folder és minden leszármazottja projektjeinek `query` és `name` mezője (a 22. feladat folder info modaljához).
   - `?search=<szöveg>&ptype=&pregion=&country=&limit=`: a szűrőknek megfelelő projektek. A nevek a `lib/projectScope.ts` cache-elt listájából szűrődnek memóriában (a szöveg kis- és nagybetűtől független részszó egyezés a `query`-n; a típus, régió, ország ugyanazokkal a regexekkel, mint az `applyProjectScope()`), majd a találatok dokumentumai `$in`-nel. Válasz: `{ ok, rows, total, byFolder: { [folderId]: n } }`; a `rows` legfeljebb `limit` (alapérték 500), a `byFolder` minden találatot számol.
   - `?search=…&fields=query&limit=5000`: csak a `query` értékek, a „Select all N filtered projects” művelethez.
2. `lib/projectScope.ts`: a 17. feladat `projectNamesWhere()` exportját használja; a névlista cache-e ürüljön az `invalidateProjectsCache()` hívásakor is (új export `clearProjectNames()`), hogy átnevezés és törlés után ne adjon elavult találatot.
3. Új `app/api/sidebar/stats/route.ts`, `GET ?folder=&project=&ptype=&pregion=&country=`: a scope `ProjectStat` összegei egy `$group`-pal (ugyanaz a nyolc mező, mint a 15. feladatban, plusz `emailMiss`, `emailTodo`). A scope a `descendantFolderIds()` (`lib/models.ts:170–177`) és az `applyProjectScope()` segítségével áll össze. Válasz: `{ ok, stats: {…} }`.
4. `lib/api.ts`: `getFolderProjects(folderId)`, `getFolderProjectNames(folderId)`, `searchProjects(q)`, `getScopeStats(q)` wrapperek.
5. Minden új ág: bemenet kényszerítése (`String()`, `parseInt` korlátokkal), `try/catch`, a `{ ok, … }` forma.
6. `apps/web/README.md` „API” szakasz az új paraméterekkel és az új route-tal.

**Elfogadási feltételek (acceptance criteria)**
- `GET /api/projects?folder=<id>` egy 384 projektes folderre 500 ms alatt válaszol production-ön; `?folder=__root__` 1 s alatt.
- `GET /api/projects?search=pizza` 1 s alatt válaszol; a `total` megegyezik azzal, amit a mai sidebar szűrő ugyanarra a szóra projektként megjelenít.
- `GET /api/sidebar/stats?folder=<id>` értékei megegyeznek a mai csempékkel ugyanarra a folderre; ugyanez típus és ország szűrővel.
- Projekt átnevezése után a `?search=` azonnal az új névre talál.
- A paraméter nélküli `GET /api/projects` változatlanul működik.

**Tesztelés**
- Kézi `fetch` hívások a dashboard konzoljából, összevetve a régi kliens oldali eredménnyel (a két út a 21. feladatig párhuzamosan él).
- Függelék „Kérések mérése”.
- `npm --prefix apps/web run typecheck` és `npm --prefix apps/web run build` (új route).

**Függőségek és kockázatok**
- A 3. feladat (kompakt formátum), a 17. feladat (`projectNamesWhere`) és a 19. feladat kell előtte.
- A mai sidebar szűrő a projekt `name` mezőjében és a folder nevében is keres (`Dashboard.tsx:574–580`). A `name` 241 513 esetben azonos a `query`-vel; a maradék 455 átnevezett projekt nevére a szerver keresés a dokumentumok betöltése után szűr rá. A folder névre a kliens szűr tovább, mert a folderek mind megvannak nála.
- A névlista 3 perces cache-e function instance-onként külön él; a `clearProjectNames()` csak azt az instance-t üríti, amelyik a módosítást kapta. Más instance legfeljebb 3 percig adhat elavult találatot egy átnevezett projektre. Ez a mai leads szűrőre is igaz.
- Az új route-ok alapból bejelentkezéshez kötöttek.

#### 21. Kliens: store és Dashboard átállítása lazy betöltésre

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | Kliens: store és Dashboard átállítása lazy betöltésre | `lib/store.ts`, `components/Dashboard.tsx`, `components/MapModal.tsx`, `components/DuplicatesModal.tsx` | A kliens minden projektet memóriában tart, és azon szűr, összegez | Ezzel a megnyitás ideje függetlenné válik a projektek számától | 🟠 | L |

**Jelenlegi állapot**
- `lib/store.ts:18–21`: a store `folders` és `summaries` (összes projekt, `query` szerint) mezőt tart; a `hydrate()` és a `refresh()` mindkettőt egyben tölti.
- `components/Dashboard.tsx`: a `summaries`-ra épül a `projFacets` (420–426), a `countryOf` és `countryOpts` (430–435), a `tree` (438–527), az `accurateMissing` (541–564), a `filtered` (568–598), a `stats` (601–620), a `globalTotal`, `scopeName`, `title`, `totalAll` (639–645) és a Lead search címkéje (1144).
- `components/MapModal.tsx:97–99` és `components/DuplicatesModal.tsx:8–15` szintén olvassa a `summaries`-t.
- Az optimista módosítások (`store.ts:118–137`: projekt átnevezés, törlés, mozgatás) a `summaries` objektumot írják.

**Probléma**
- A B és C csoport után is minden megnyitáskor 241 968 projekt töltődik le és kerül memóriába (a mérésnél a JS heap 111 MB volt), és minden új scrape növeli.
- Ha nem javítjuk: a betöltési idő a projektszámmal együtt újra nőni fog, és a 3–4. feladat nyeresége elkopik.

**Megoldás**
1. **Store** (`lib/store.ts`):
   - a `summaries` helyett `sidebar: SidebarPayload | null` és `projectsByFolder: Record<string, ProjectSummary[]>` (kulcs a folder id, illetve `__root__`), plusz `loadingFolders: Set<string>`;
   - `hydrate()`: `api.getSidebar()` a 4. feladat mintájával (előbb `force-cache`, utána revalidáció, ETag összevetéssel); a `folders` a `sidebar.folders`-ből áll elő, így a `GET /api/folders` hívás induláskor megszűnik;
   - `loadFolder(id)`: `api.getFolderProjects(id)`, az eredmény a `projectsByFolder`-be;
   - `setFolderCollapsed(id, false)`: ha a folder projektjei nincsenek betöltve, hívja a `loadFolder`-t;
   - `refresh()`: újratölti a sidebart és a már betöltött foldereket;
   - az optimista projekt műveletek a `projectsByFolder` listáit módosítják, és ugyanabban a lépésben korrigálják az érintett folder `own` összesítőit (törlésnél kivonás, mozgatásnál átvezetés).
2. **Fa és badge-ek** (`Dashboard.tsx`): a 8. feladat `folderTotals` memója a `sidebar.folders[].own` értékeiből számolja a rekurzív összegeket; a `projIndex` a `projectsByFolder`. A 7. feladat `visibleRows` listája a nyitott, de még töltődő foldernél három `.skel-bar` helykitöltő sort ad.
3. **„Ungrouped” csoport**: a fejléc darabszáma a `sidebar.ungrouped.projects`; kinyitáskor `loadFolder('__root__')`.
4. **Szűrő opciók**: a `projFacets` és a `countryOpts` a `sidebar.facets`-ből jön; a `countryOf` memo megszűnik. A `Dashboard.tsx:1236` régió szűkítése a `facets.regions` elemein a `parseProjectGeo`-val marad.
5. **Sidebar szűrő**: a `filtered` memo helyett 300 ms debounce után `api.searchProjects({ search, ptype, pregion, country })`. A találatok `folderId` szerint csoportosítva jelennek meg, a találatot tartalmazó folderek nyitva; a folder nevére a kliens szűr, ahogy ma. Ha a `total` nagyobb a visszaadott soroknál, a lista alján: `Showing first 500 of N matches.` A „Select all N filtered projects” az `api.searchProjects({ …, fields: 'query', limit: 5000 })` eredményét jelöli ki.
6. **Csempék**: szűrő és scope nélkül a `sidebar.all`; folder scope-nál szűrő nélkül a folder rekurzív `own` összege; minden más esetben `api.getScopeStats()` (a scope vagy a szűrő változásakor, a 11. feladat darabszám-rövidítése ugyanebből az értékből dolgozik).
7. **Címkék**: a `title`, a `scopeName` és a Lead search címke az aktív projekt nevét a betöltött listákból veszi, ennek híján a `query`-t mutatja.
8. **Többi komponens**: `DuplicatesModal.tsx:15` a projekt nevét a `query`-re cseréli (241 513 esetben azonos); a `MapModal.tsx` a 16. feladat után már nem olvassa a `summaries`-t.
9. **Takarítás**: a paraméter nélküli `GET /api/projects` ág, a `getProjectsGz()` és a `projects` cache kulcs megszűnik, mert nincs több hívója; a `computeProjects()` a `lib/sidebar.ts`-be költözik. A `lib/api.ts` `getProjects*` wrapperei és a `GET /api/folders` ETag ága törlendő, ha nincs más hívójuk (az `ImportModal.tsx:21` a `hydrate()`-et hívja, az marad).
10. `docs/ARCHITECTURE.md` §04 „State” (a store új tartalma), §06 (a projects payload döntés átírása a sidebar összesítőre), `apps/web/README.md` „Structure” és „API”.

**Elfogadási feltételek (acceptance criteria)**
- A dashboard megnyitása nem indít paraméter nélküli `/api/projects` kérést; az induló kérések összes `transferSize` értéke 500 KB alatt van (baseline: 5,88 MB hidegen).
- A hydrate utáni leghosszabb long task 300 ms alatt van (baseline: 8 396 ms).
- A megnyitás utáni JS heap 40 MB alatt van (baseline: 111 MB).
- Egy folder kinyitása 1 s-on belül mutatja a projektjeit; az újranyitás nem indít kérést.
- Változatlanul működik: projekt és folder átnevezés, mozgatás (kijelöléssel és drag-and-droppal), törlés, a szöveges és a típus/régió/ország szűrő, a „Select all filtered”, az export (projekt kijelölésre és folderre), az Organize, a Recount, az Import.
- A csempék és a folder badge-ek értéke megegyezik a változtatás előttivel „All leads”, egy gyökér folder, egy levél folder és egy típus + ország szűrő mellett.

**Tesztelés**
- Kézi ellenőrző lista a fenti műveletekre, mindegyik után oldal újratöltéssel (az optimista állapot és a szerver állapota egyezik-e).
- Függelék mindhárom snippetje a megnyitás után.
- `npm --prefix apps/web run typecheck`, `npm --prefix apps/web run build`.
- Indítás előtt a terv szerint (CLAUDE.md „Plan first”): a feladat több mint 5 fájlt érint, ezért írott tervvel és a `/review-changes` futtatásával zárul.

**Függőségek és kockázatok**
- Előfeltétel: 7., 8., 11., 16., 19., 20. feladat. A 3–4. feladat kódjának egy része (a teljes payload dekódolása) ezzel megszűnik; a formátum és a `force-cache` minta megmarad.
- A legnagyobb kockázat az optimista módosítások és a szerver összesítők eltérése (pl. mozgatás két folder között, miközben az egyik nincs betöltve). Védelem: minden szerkezeti művelet után a store a háttérben újrakéri a sidebart (a művelet a szerveren érvényteleníti a cache-t), így az eltérés legfeljebb egy kérés idejéig él.
- A shift-kattintásos tartománykijelölés csak a betöltött és látható projekteken működik; ez megegyezik a mai viselkedéssel, mert ma is a látható sorrenden megy.
- A szűrő találati listája 500 sorra korlátozott; a tömeges műveletekhez a „Select all” 5 000 projektig működik. Ennél nagyobb találati halmazon a művelet előtt szűkíteni kell.
- Mivel a feladat L méretű és a dashboard központi komponensét írja át, külön ágon való fejlesztés helyett (a projektben nincs feature branch) lépésenként, működő állapotokkal commitolandó: store, fa, szűrő, csempék, takarítás.

#### 22. Coverage badge és folder info szerver oldali adatból

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | Coverage badge és folder info szerver oldali adatból | `lib/coverage.mjs` (új), `lib/sidebar.ts`, `components/Dashboard.tsx`, `components/FolderInfoModal.tsx` | A pontos „missing” badge a kliensen fut a teljes projektlistán, és induláskor 860 KB referencia adatot tölt be | A 21. feladat után a kliensnek nincs meg hozzá az adata | 🟡 | M |

**Jelenlegi állapot**
- `Dashboard.tsx:485–511`: az olcsó `missingOf` becslés a folder nevéből, a gyerek folderek nevéből és a projektek számából számol; ehhez a 21. feladat után is megvan minden adat.
- `Dashboard.tsx:541–564`: a pontos `accurateMissing` a folder alatti összes projekt nevét és `query`-jét használja.
- `Dashboard.tsx:531–537`: a `lib/states.ts` (468 KB) és a `lib/countryAreas.ts` (392 KB) minden megnyitáskor betöltődik a badge miatt.
- `Dashboard.tsx:829–843` `openFolderInfo()`: a coverage modalnak átadja a folder alatti összes projekt nevét és régióját.

**Probléma**
- A 21. feladat után a kliens csak a kinyitott folderek projektjeit ismeri, a pontos badge-hez és a modalhoz a teljes részfa nevei kellenének.
- A 860 KB referencia adat betöltése és a számítás minden megnyitást terhel, akkor is, ha senki nem néz coverage számot.

**Megoldás**
1. Új `lib/coverage.mjs` tiszta függvényekkel, a `Dashboard.tsx:39–57` segédfüggvényeiből (`covNorm`, `covStateOf`, `covRegionOf`, `covCountryPrefix`) és a 541–564. sor logikájából: `accurateMissingFor(folderName, names, refs)`. `lib/coverage.test.mjs` a mai viselkedés rögzítésére: több szavas business type (`Alabama Physical Therapy`), `West Virginia` és `Virginia`, város folder, ismeretlen régió.
2. `lib/sidebar.ts` `buildSidebarAggregates()`: a rebuild során minden nem gyökér folderre kiszámolja a pontos `missing` értéket a `lib/coverage.mjs`, a `lib/states.ts` és a `lib/countryAreas.ts` segítségével (a szerveren a `lib/states.ts`-t a `app/api/missing-states/route.ts` már ma is importálja), és a folder `own` mezői mellé teszi. Ahol nincs referencia lista, a mező hiányzik.
3. `Dashboard.tsx`: a piros badge a `sidebar.folders[].missing` értéket mutatja, ennek híján az olcsó `missingOf` becslést. A `covData` state, a 531–537. sor lusta importja és az `accurateMissing` / `missingFor` számítás megszűnik.
4. `openFolderInfo()`: a nevek és régiók a `api.getFolderProjectNames(folderId)` hívásból jönnek (20. feladat, `deep=1&fields=names`), a ⓘ ikonra kattintáskor. A `FolderInfoModal` a betöltés alatt `Loading…` állapotot, hiba esetén `Could not load coverage.` üzenetet mutat; a props formája (`names`, `regions`, `cities`) nem változik.

**Elfogadási feltételek (acceptance criteria)**
- A dashboard megnyitása nem tölti be a `states` és `countryAreas` chunkot (DevTools Network, JS szűrő); ezek csak a coverage modal vagy a Map megnyitásakor érkeznek.
- A piros badge értéke öt kiválasztott folderen (két állam, két város, egy gyökér) megegyezik a változtatás előttivel.
- A coverage modal (ⓘ) hiányzó helyeinek listája megegyezik a változtatás előttivel ugyanarra a folderre.
- `node --test apps/web/lib/coverage.test.mjs` zöld.

**Tesztelés**
- Unit teszt a fenti esetekre.
- Kézi összevetés a badge-ekre és a modalra a változtatás előtt és után.
- Függelék „Kérések mérése”: a `/api/sidebar` rebuild ideje a `missing` számítással együtt 60 s alatt marad.

**Függőségek és kockázatok**
- Előfeltétel: 19., 20., 21. feladat.
- A rebuild a szerveren minden folderre lefuttatja a token keresést. A mikro-benchmark szerint ez folderenként 5 ms nagyságrendű, 774 folderre néhány másodperc, háttérben (`after()`), nem a kérésben. Ha a rebuild a 60 s-os keretet megközelíti, a `missing` számítás külön cache kulcsba és hosszabb TTL-re szervezendő.
- A badge frissessége a sidebar cache-ét követi (legfeljebb 120 s + egy megnyitás).
- A logika másolása helyett áthelyezés történik: a `Dashboard.tsx` segédfüggvényei a `lib/coverage.mjs`-ből importálódnak, hogy ne legyen két példány.

### G. Mérés és dokumentáció

#### 23. `Server-Timing` fejléc és a docs frissítése

| # | Feladat | Hol (fájl/modul) | Probléma | Miért fontos | Súly | Méret |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | `Server-Timing` fejléc és a docs frissítése | `lib/models.ts`, `app/api/leads/route.ts`, `app/api/projects/route.ts`, `docs/ARCHITECTURE.md`, `README.md` | Nem látszik, hogy egy lassú kérésből mennyi az adatbázis és mennyi a hálózat; a docs a régi cache működést írja le | Az elfogadási feltételek ellenőrizhetők, a docs igaz marad | 🟡 | S |

**Jelenlegi állapot**
- A route-ok nem közölnek időmérést. A terv készítésekor a szerver és az adatbázis idejét csak külön `explain` futtatással lehetett szétválasztani a hálózattól.
- `lib/models.ts:219–224`: a `json()` segédfüggvény állítja össze a válasz fejléceit.
- `docs/ARCHITECTURE.md` §06 a `/api/projects` cache-t a mai (időbélyeges ETag) formában írja le; a §07 nem sorolja fel az indexeket; a §09 nem említi a function régiót.

**Probléma**
- Egy 2 s-os kérésről a böngészőből nem dönthető el, hogy a MongoDB, a hideg indulás vagy a hálózat lassú. Enélkül a terv elfogadási feltételeinek egy része csak az Atlas UI-ból ellenőrizhető.
- Ha a docs nem követi a változásokat, a következő agent vagy fejlesztő a régi működés alapján dönt.

**Megoldás**
1. `lib/models.ts`: a `json()` kapjon opcionális harmadik paramétert (`timing?: Record<string, number>`), amiből `Server-Timing` fejlécet ír (`db;dur=12.3, total;dur=15.0`). A `CORS` objektum bővüljön az `Access-Control-Expose-Headers: Server-Timing` fejléccel.
2. `app/api/leads/route.ts` `GET` és `app/api/projects/route.ts` `GET` (később a `app/api/sidebar/route.ts` is): mérje `performance.now()`-val a `dbConnect()` idejét (`connect`), a lekérdezések együttes idejét (`db`) és a teljes handler időt (`total`), és adja át a `json()`-nak. A `projects` route saját `Response`-t épít, ott a fejléc közvetlenül kerül a `headers` objektumba.
3. `docs/ARCHITECTURE.md`: a terv feladatai által megjelölt pontok átvezetése (§04, §06, §07, §09), feladatonként abban a commitban, amelyik a viselkedést megváltoztatja; ez a feladat a végén ellenőrzi, hogy mind megtörtént.
4. Root `README.md` „Documentation” szakasz: hivatkozás erre a dokumentumra. `apps/web/README.md`: a „Data — MongoDB” és „API” szakasz egyezzen a végállapottal.
5. `docs/TASKS.md`: a terv feladatai T-### azonosítóval, a kész feladatok kipipálva.

**Elfogadási feltételek (acceptance criteria)**
- A `GET /api/leads` válasza tartalmaz `Server-Timing` fejlécet `connect`, `db` és `total` értékkel, és a DevTools Network „Timing” fülén megjelenik.
- A Függelék „Kérések mérése” snippetje kiírja a `serverTiming` értékeket.
- A `docs/ARCHITECTURE.md` §06 cache leírása, §07 indexlistája és §09 régió sora megegyezik a production állapottal.
- A fejléc nem tartalmaz lekérdezés szöveget, kulcsot vagy más adatot, csak megnevezést és időt.

**Tesztelés**
- DevTools Network → `/api/leads` → Timing fül.
- A docs átolvasása a kódhoz képest a `/review-changes` paranccsal.

**Függőségek és kockázatok**
- Az 1. feladattal együtt érdemes bevezetni, hogy a régióváltás hatása pontosan mérhető legyen.
- A `CORS` objektum módosítása az ARCHITECTURE.md §08 szerint jóváhagyást igényel. A változás egyetlen, csak olvasható fejléc láthatóvá tétele; ha ez nem kívánt, az `Access-Control-Expose-Headers` elhagyható, mert a dashboard azonos originről hív, és ott a fejléc enélkül is olvasható.
- A `Server-Timing` értékek bárki számára láthatók, aki a választ megkapja; az érintett route-ok bejelentkezéshez kötöttek.

## 3. Javasolt sorrend

A csomagok egymásra épülnek; egy csomagon belül a feladatok a felsorolt sorrendben készülnek. Az idő a méretkategóriák összege (S ≤ 1 nap, M 2–5 nap, L 1+ hét), egy fejlesztőre.

| Csomag | Cél | Feladatok | Becsült idő |
| --- | --- | --- | --- |
| P0 – Alapok | Régió, mérhetőség. Minden további mérés ehhez viszonyít | 1, 23 | 1–2 nap |
| P1 – Első betöltés, gyors nyereségek | A lead tábla 2 s-on belül látszik, a payload nem töltődik le feleslegesen, a felesleges induló kérések megszűnnek | 5, 2, 6, 9, 12 | 3–5 nap |
| P2 – Sidebar render | A hydrate utáni long task és a kattintások akadása megszűnik | 7, 8 | 3–6 nap |
| P3 – Payload és azonnali megjelenés | Kisebb letöltés, a sidebar a cache-ből azonnal megjelenik | 3, 4 | 1–2 nap |
| P4 – Lead tábla | Rendezés, szűrés és keresés másodperc alatt | 10, 11, 13, 14 | 5–8 nap |
| P5 – Többi nézet | Stats, Reviews, Map, Duplicates | 15, 17, 16, 18 | 6–12 nap |
| P6 – Lazy sidebar | A megnyitás ideje független a projektszámtól | 19, 20, 21, 22 | 3–4 hét |

Megjegyzések a sorrendhez:
- A P0 és a P1 együtt hozza a legnagyobb változást a panaszolt 20–30 másodpercen: a tábla megjelenése a navigáció után 2 s körülre kerül, a sidebar hálózati ideje változatlan adatnál 304-re csökken.
- A P2 nélkül a sidebar megérkezésekor a felület még másodpercekre megáll; ezért követi közvetlenül a P1-et.
- A P4 és a P5 független a P2–P3-tól, párhuzamosan vagy előrébb hozva is elkészíthető.
- A P6 a P2, P3 és a 11., 16., 17. feladat után indítható. Addig a P1–P3 állapota stabil, használható végállapot.

## Függelék: mérési módszer

A baseline számok ezekkel a lépésekkel készültek; az elfogadási feltételek ugyanígy ellenőrizhetők. Mindegyik csak olvas.

**Kérések mérése.** A dashboard betöltése után a böngésző konzoljában:

```js
const clean = (n) => { const u = new URL(n); const k = [...u.searchParams.keys()].join('+'); return u.pathname + (k ? ' [' + k + ']' : ''); };
console.table(performance.getEntriesByType('resource')
  .filter((e) => e.name.includes('/api/'))
  .map((e) => ({
    url: clean(e.name),
    start: Math.round(e.startTime),
    ttfb: Math.round(e.responseStart - e.requestStart),
    download: Math.round(e.responseEnd - e.responseStart),
    transfer: e.transferSize,
    decoded: e.decodedBodySize,
    status: e.responseStatus,
    serverTiming: e.serverTiming.map((t) => `${t.name}=${Math.round(t.duration)}`).join(' '),
  })));
```

A `start` a navigáció kezdetétől mért idő ms-ban. Hideg mérés: legalább 3 perccel az előző megnyitás után. Meleg mérés: azonnali újratöltés.

**DOM és long task mérés.** Betöltés után:

```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) console.log('long task', Math.round(e.startTime), '+', Math.round(e.duration), 'ms');
}).observe({ type: 'longtask', buffered: true });
console.log('DOM nodes', document.getElementsByTagName('*').length, 'navitems', document.querySelectorAll('.navitem').length);
console.log('heap MB', performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 'n/a');
```

A megfigyelő a betöltés óta történt long taskokat is kiírja, és nyitva hagyva a későbbi kattintásokét is (folder nyitás, szűrés).

**Régió ellenőrzése.** `(await fetch('/api/tags')).headers.get('x-vercel-id')`: a két kettőspont közötti rész a function régiója.

**Lekérdezési terv.** Atlas UI → Collections → a collection → Explain Plan: a szűrő és a rendezés megadása után a terv szakaszai (`IXSCAN`, `COLLSCAN`, `SORT`), a vizsgált kulcsok és dokumentumok száma és a futási idő. Indexek mérete és használata: ugyanott az Indexes fül.
