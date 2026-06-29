# Scrape gyorsítás — terv

> Cél: a jelenlegi „irdalmatlan lassú" scrape felgyorsítása. Röviden: a lassúság oka,
> a fő megoldás (10×+), és gyors, kis kockázatú nyerések, amíg odáig eljutunk.

## TL;DR
A keresési adat **már most is a `/search?pb=…` protobuf RPC-ből** jön (a `GridLeadsParser` ezt parse-olja).
A görgetés (DOM scroll) **csak arra való, hogy a Google lekérje a következő oldalt** — a renderelés és a görgetés
maga **felesleges idő**. A nyerő lépés: a következő oldalakat **közvetlenül `fetch`-eljük** (offset léptetéssel),
**renderelés és tab nélkül**, és **párhuzamosan** több keresést futtatunk.

---

## Miért lassú most? (3 szűk keresztmetszet)

1. **Szekvenciális, 1 tab, előtérben.** Egyszerre **egy** keresés fut. A Chrome a háttér-tabokat fékezi,
   ezért a tabnak előtérben kell lennie → nincs párhuzamosság.
2. **Görgetés-vezérelt lapozás.** Keresésenként: `wait(2200)` nav után + görgetési lépésenként
   `~1600–2300ms` + **3× „end" megerősítés** (`~2600ms` egyenként) + `wait(1200)` settle.
   Egy ~120 találatos keresés könnyen **20–40 mp** csak az overhead miatt — a tényleges adat
   (a protobuf) eközben mellékhatásként jön be.
3. **Teljes Maps SPA renderelés.** Minden kártya, térkép-csempe, ikon kirajzolódik → nehéz CPU, lassú.

```
  MOST (keresésenként):
  navigál(2.2s) → [scroll 1.6s → /search RPC] × N → end-confirm 3×(2.6s) → settle(1.2s)
  └── csak EGY keresés egyszerre, előtérben ───────────────────────────────────────────┘
```

---

## Fő megoldás (10×+): közvetlen lapozott RPC-fetch + párhuzamosság

A `/search?pb=` URL `pb` paramétere kódol egy **oldal-offsetet** (Maps-nél tipikusan a `!8i0` → `!8i20` →
`!8i40` … léptetés, oldalanként ~20 találat). Tehát:

1. **Első oldal URL megszerzése** keresésenként: vagy egyszer elkapjuk a meglévő `webRequest` úton
   (1 gyors navigáció), vagy összeállítjuk a `pb` sablonból.
2. **Lapozás `fetch`-csel**: az offsetet (`8i`) léptetve `fetch(url, {credentials:'include'})` a háttér
   service workerből, amíg egy oldal **0 új helyet** ad vissza. A választ a meglévő
   `GridLeadsParser.parseSearchResponse` parse-olja → **nincs DOM, nincs scroll, nincs render**.
3. **Párhuzamosítás**: egyszerre **3–6 keresés** fut (Promise pool a háttérben). Mivel nincs tab/render,
   nincs Chrome-throttling korlát.

```
  ÚJ (keresésenként):  fetch oldal0 → parse → fetch oldal1 → parse → … (0 új-ig)
  └── 3–6 keresés EGYSZERRE, háttér fetch, renderelés nélkül ───────────────────┘
```

**Becsült gyorsulás:** keresésenként ~20–40 mp → **~1–3 mp**; plusz 3–6× párhuzam → összességében **10–30×**.

**Megvalósítás a meglévő kódból:**
- A parser (`mapsParser.js`) és a sync (`/api/sync`, chunked) **változatlanul újrahasználható**.
- Új: egy `fetchAllPages(firstUrl)` a `background.js`-ben (offset-léptető ciklus) + egy `pool(items, N)`.
- A `content.js` görgetés **megszűnik** a fő útvonalon (megtartható fallbacknek, ha egy query 0-t ad).

> ⚠️ Ellenőrzés: a pontos lapozó-tokent (`8i` vs `ech=`/folytatási token) **egy valódi elkapott
> `/search?pb=` URL-en** kell visszaigazolni — innen derül ki a léptetés mintázata.

---

## Gyors nyerések (kis kockázat, fél nap, ha a fő refaktor még odébb van)

1. **Görgetési idők csökkentése** (`content.js`): `NEED_END` 3 → **1–2**; scroll `sleep` 1600 → **600–800ms**;
   end-confirm 2600/2200 → **~1000ms**; settle `wait(1200)` → **600ms**. → keresésenként **~40–50% le**.
2. **Több ablak párhuzamosan**: 2–3 **külön Chrome-ablak**, mindegyik a sajátjában „előtér" — a Chrome
   az önálló ablakokat kevésbé fékezi, mint a háttér-tabokat → **2–3× párhuzam** a render-út megtartásával.
3. **Stream-to-DB már megvan** — tartsd bekapcsolva (nem gyűlik a böngésző-tárban, nincs nagy végső sync).

---

## Alternatíva: hivatalos Google Places API (fizetős)

- **Előny:** gyors, megbízható, natívan párhuzamos, nincs CAPTCHA/blokk-kockázat.
- **Hátrány:** **fizetős** (lekérdezésenként díj), és **max ~60 találat/keresés** (a Maps DOM ~120-at ad).
- Akkor éri meg, ha a megbízhatóság/sebesség fontosabb a teljes lefedettségnél és a 0 költségnél.

---

## Kockázatok és kezelésük (a fő megoldásnál)

| Kockázat | Kezelés |
|---|---|
| Rate-limit / soft-block / CAPTCHA agresszív fetchnél | Mérsékelt párhuzam (**3–6**), **jitteres** szünetek, **429-re backoff**, a user belépett session-je (`credentials:'include'`) |
| `pb` lapozó-token változik | Egy valódi URL-ből kalibrálni; ha a fetch 0/hibás → **fallback a meglévő görgetésre** |
| Maps válasz-formátum változás | A meglévő `unwrap`/`parseSearchResponse` marad a forrás-igazság; loggolni a 0-parse esetet (már van) |
| MV3 service worker leáll | Állapotot `chrome.storage`-ba (mint a batch engine), `alarms` watchdog (mint most) |

---

## Javasolt sorrend

1. **Most azonnal:** gyors nyerések #1 + #2 (görgetési idők le + 2–3 ablak) → érezhető gyorsulás kockázat nélkül.
2. **Fő refaktor:** `fetchAllPages` + Promise-pool a háttérben, a parser/sync újrahasználásával; görgetés fallbacknek.
3. **Finomhangolás:** párhuzam-szint és backoff belövése a blokk-küszöb alá; opcionálisan Places API a kritikus régiókra.

**Lényeg:** a görgetés a tényleges szűk keresztmetszet, miközben az adat már a fetch-elhető RPC-ben van —
ezt kihagyva és párhuzamosítva a scrape nagyságrendekkel gyorsul.
