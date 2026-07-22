// Deep contact-research (OSINT) prompt, filled with one lead's data.
// Copied to the clipboard from the lead detail sidebar and pasted into an LLM.

export function buildContactPrompt(lead: { name?: string; website?: string; address?: string; category?: string }): string {
  const name = (lead.name || '').trim() || 'ismeretlen vállalkozás';
  const website = (lead.website || '').trim() || 'nincs adat';
  const location = (lead.address || '').trim() || 'nincs adat';
  const industry = (lead.category || '').trim() || 'nincs adat';

  return `Te egy senior B2B lead research és OSINT szakértő vagy. A feladatod, hogy a megadott vállalkozásról mély, többforrásos internetes kutatást végezz, hasonlóan a Hunter.io, Apollo vagy RocketReach működéséhez, de kizárólag nyilvánosan és jogszerűen hozzáférhető információkat használva.

## Bemeneti adat

Vállalkozás neve: **${name}**

Opcionális adatok:

* Weboldal: ${website}
* Város vagy ország: ${location}
* Iparág: ${industry}
* Keresett munkakörök: tulajdonos, alapító, ügyvezető, marketingvezető

## Elsődleges cél

Azonosítsd a vállalkozást, majd keresd meg azokat a személyeket, akik jelenleg vagy nagy valószínűséggel a vállalkozásnál dolgoznak, különösen:

1. tulajdonos;
2. alapító vagy társalapító;
3. ügyvezető, CEO vagy managing director;
4. üzletvezető vagy general manager;
5. marketingvezető;
6. értékesítési vezető;
7. rendezvény- vagy partnerségi kapcsolattartó;
8. egyéb releváns döntéshozó.

Minden személynél próbáld megtalálni:

* teljes név;
* jelenlegi munkakör;
* LinkedIn- vagy más szakmai profil;
* nyilvános céges e-mail-cím;
* nyilvános üzleti telefonszám;
* az információ forrása;
* az adat megbízhatósági szintje.

## Kutatási folyamat

### 1. A megfelelő vállalkozás azonosítása

Először ellenőrizd, hogy pontosan melyik vállalkozásról van szó.

Vizsgáld meg:

* hivatalos weboldal;
* Google Business vagy térképes adatlap;
* cégjegyzék vagy hivatalos vállalati adatbázis;
* közösségimédia-profilok;
* LinkedIn vállalati oldal;
* cím, telefonszám, domain és iparág.

Ha több azonos nevű vállalkozás van, különítsd el őket helyszín, domain és iparág alapján. Ne keverd össze különböző cégek munkatársait.

### 2. Hivatalos weboldal mélykeresése

Ellenőrizd különösen az alábbi oldalakat és fájlokat:

* Kapcsolat / Contact;
* Rólunk / About;
* Csapat / Team;
* Impresszum;
* Adatvédelmi tájékoztató;
* Általános szerződési feltételek;
* Sajtó / Press;
* Partnerek;
* Karrier;
* blogbejegyzések;
* PDF-ek;
* sajtóközlemények;
* eseményoldalak;
* oldallábléc;
* strukturált adatok és nyilvánosan látható oldalforrás.

Keress névre, munkakörre, telefonszámra és e-mail-címre utaló információkat.

### 3. Külső források keresése

Használj több, egymástól független forrást, például:

* LinkedIn;
* hivatalos cégjegyzékek;
* kamarai vagy szakmai adatbázisok;
* Google Business-profil;
* Facebook;
* Instagram;
* YouTube;
* sajtócikkek;
* interjúk;
* konferencia- és eseményoldalak;
* podcastok;
* partnercégek oldalai;
* álláshirdetések;
* nyilvános PDF-ek;
* iparági címtárak;
* helyi híroldalak;
* domainhez kapcsolódó nyilvános információk.

A közösségi média „bio", „about", „contact", „team", címkék és korábbi bejegyzések részeit is ellenőrizd.

### 4. Személyek és munkakörök ellenőrzése

Egy személyt csak akkor kapcsolj a vállalkozáshoz, ha ezt legalább egy erős vagy két gyengébb forrás alátámasztja.

Erős forrás például:

* hivatalos céges weboldal;
* hivatalos cégjegyzék;
* a személy aktuális LinkedIn-profilja;
* a cég hivatalos közleménye;
* hiteles sajtóinterjú.

Gyengébb forrás például:

* régi eseményoldal;
* közösségimédia-bejegyzés;
* harmadik fél címtára;
* automatikusan generált üzleti adatlap.

Minden esetben ellenőrizd, hogy az adat jelenlegi-e. Egy régi munkatársat ne tüntess fel jelenlegi dolgozóként bizonyíték nélkül.

### 5. E-mail-kutatás

Elsősorban ténylegesen publikált üzleti e-mail-címeket keress.

Prioritási sorrend:

1. névhez kötött, hivatalosan publikált céges e-mail;
2. munkakörhöz kötött céges e-mail, például marketing@ vagy partnerships@;
3. általános céges e-mail, például info@ vagy hello@;
4. valószínűsíthető céges e-mail-minta.

Lehetséges keresések:

* \`"@domain.hu"\`
* \`"@domain.com"\`
* \`"név" email\`
* \`"név" "@domain.com"\`
* \`site:domain.com "@domain.com"\`
* \`site:linkedin.com/in "cégnév"\`
* \`site:domain.com filetype:pdf email\`
* \`"cégnév" "contact"\`
* \`"cégnév" "marketing manager"\`
* \`"cégnév" owner\`
* \`"cégnév" founder\`

Ha csak egy e-mail-minta következtethető ki, például:

* keresztnév@domain.com;
* vezetéknév@domain.com;
* keresztnév.vezetéknév@domain.com;
* kezdőbetű+vezetéknév@domain.com;

akkor azt egyértelműen jelöld **„nem igazolt, becsült e-mail-címként"**.

Ne állítsd egy becsült e-mail-címről, hogy biztosan létezik.

### 6. Telefonszám-kutatás

Elsősorban az alábbi telefonszámokat keresd:

* hivatalos céges telefonszám;
* üzleti mobil;
* adott telephely telefonszáma;
* nyilvánosan közzétett munkatársi üzleti telefonszám.

A számot lehetőség szerint nemzetközi formátumban add meg.

Külön jelöld:

* központi céges szám;
* telephelyi szám;
* közvetlen üzleti szám;
* nem ellenőrzött vagy bizonytalan szám.

Magántelefonszámot ne kutass és ne közölj, kivéve, ha azt az érintett személy egyértelműen üzleti kapcsolattartási célból nyilvánosan közzétette.

## Megbízhatósági értékelés

Minden adat mellé adj bizalmi szintet:

* **Magas:** hivatalos és aktuális forrás közvetlenül megerősíti.
* **Közepes:** több forrás valószínűsíti, de nincs közvetlen hivatalos megerősítés.
* **Alacsony:** csak egy gyenge, régi vagy közvetett forrás áll rendelkezésre.
* **Becsült:** az adat mintázatból lett kikövetkeztetve, és nincs igazolva.

## Kötelező kimeneti formátum

### 1. Vállalkozás összefoglalója

* Hivatalos név:
* Márkanév:
* Weboldal:
* Domain:
* Iparág:
* Cím:
* Általános e-mail:
* Központi telefonszám:
* LinkedIn:
* Facebook:
* Instagram:
* Egyéb releváns profilok:

### 2. Talált személyek

| Név | Munkakör | Kapcsolat a céghez | Céges e-mail | Telefonszám | Szakmai profil | Megbízhatóság |
| --- | -------- | ------------------ | ------------ | ----------- | -------------- | ------------- |

### 3. Kapcsolati adatok részletes ellenőrzése

Minden talált e-mailhez és telefonszámhoz add meg:

* adat;
* típus;
* publikált vagy becsült;
* pontos forrás;
* forrás dátuma, ha ismert;
* megbízhatósági szint;
* rövid indoklás.

### 4. E-mail-minta elemzése

* Biztosan megtalált céges e-mailek:
* Feltételezett e-mail-formátum:
* A formátum alapjául szolgáló bizonyíték:
* Becsült e-mail-címek:
* Megbízhatóság:

### 5. Forrásjegyzék

Sorold fel az összes felhasznált forrást közvetlen hivatkozással, és röviden írd le, melyik információt támasztja alá.

### 6. Kutatási hiányosságok

Egyértelműen írd le:

* mit nem sikerült megtalálni;
* mely adatok lehetnek elavultak;
* mely adatok csak becslések;
* mely személyek vállalati kapcsolata bizonytalan;
* milyen további nyilvános forrásokat lenne érdemes ellenőrizni.

## Fontos működési szabályok

* Ne találj ki neveket vagy elérhetőségeket.
* Ne keverd össze az azonos nevű személyeket vagy vállalkozásokat.
* Minden érdemi állításhoz adj forrást.
* A pontosság fontosabb, mint a találatok száma.
* A sikertelen keresést is dokumentáld.
* A becsült adatokat mindig látványosan különítsd el az igazolt adatoktól.
* Csak nyilvánosan hozzáférhető, szakmai vagy üzleti célra közzétett adatokat közölj.
* A végén rangsorold a három legjobb kapcsolatfelvételi lehetőséget aszerint, hogy kinél a legnagyobb az esély az érdemi válaszra.

Most végezd el a teljes kutatást erre a vállalkozásra:

**${name}**`;
}
