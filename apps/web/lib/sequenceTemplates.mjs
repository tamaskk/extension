// Ready-made sequences the editor can start from, so a first campaign does not
// begin with an empty page. Pure data.
//
// The opening email names the three services in a few lines; emails two to four
// give the details of one each, in the thread of the first. A template is only
// a starting point: it is copied into a new, switched-off sequence, and every
// word can be changed before it is saved.
//
// The texts use {{name}} only: every lead has a name, so no lead is left out
// for a missing value. The footer (name, postal address, how to stop) is not in
// them; it is attached to every email in code (lib/outreachFooter.mjs).

const step = (delayDays, subject, body, sameThread) => ({ delayDays, subject, body, sameThread, enabled: true });

export const SEQUENCE_TEMPLATES = [
  {
    key: 'three-services-en',
    label: 'Three services, English',
    name: 'Three services, English',
    language: 'en',
    steps: [
      step(0, 'A few ideas for {{name}}', `Hi,

I'm Tamás. I help local businesses like {{name}} get more customers online. I can help in three ways:

- Websites: a fast, clear site that turns visitors into calls and bookings.
- AI automation: answering enquiries, booking appointments and following up, so no enquiry goes unanswered.
- Social media: regular posts and ads that keep you in front of local customers.

In a short meeting I can show you finished work, not ideas: a website made for your business, a working AI automation and a social media plan. All three, or only the one you care about.

If you'd like to see it, just reply and I'll send a few possible times. If you have a time that suits you, I'm happy to fit around it.

Tamás`, false),
      step(3, '', `Hi,

A bit more on the website side, in case it's the useful one for {{name}}.

Most small business sites lose people in the first few seconds: slow to load, hard to read on a phone, no clear way to call or book. I build sites that fix exactly that, and I keep them simple enough that you can update them yourself.

I can show you the site made for your business, finished, in a short meeting. If you'd like to see it, reply and I'll send a few possible times, or tell me what suits you.

Tamás`, true),
      step(4, '', `Hi,

One more thing I mentioned: AI automation.

In practice it means the routine messages get handled without you. An enquiry at 9pm gets an answer, an appointment gets booked, a missed call gets a follow-up text. You step in only where a person is needed.

In a short meeting I can show it working, set up the way it would run for you. If that would take some weight off, reply and I'll send a few possible times, or name a time that works for you.

Tamás`, true),
      step(5, '', `Hi,

Last one from me: social media.

I plan and produce regular posts and run small local ad campaigns, so people nearby keep seeing {{name}} and know what's new. You approve what goes out; I do the rest.

I can show you the plan made for you in a short meeting, together with the website and the automation if you like. If you'd like to see it, reply and I'll send a few possible times, or tell me when suits you. If none of this is for you, no need to answer, and I won't write again.

Tamás`, true),
    ],
  },
  {
    key: 'three-services-hu',
    label: 'Három szolgáltatás, magyar',
    name: 'Három szolgáltatás, magyar',
    language: 'hu',
    steps: [
      step(0, '{{name}}: néhány ötlet', `Sziasztok!

Kálmán Tamás vagyok, helyi vállalkozásoknak segítek abban, hogy több ügyfelet szerezzenek az interneten. Azért írok, mert úgy látom, Önöknél ({{name}}) is lenne ebben lehetőség. Három területen tudok segíteni:

- Weboldal: gyors, átlátható oldal, amelyről a látogató könnyen telefonál vagy időpontot foglal.
- AI automatizálás: az érdeklődések megválaszolása, időpontfoglalás és utánkövetés, hogy egyetlen érdeklődő se maradjon válasz nélkül.
- Közösségi média: rendszeres bejegyzések és hirdetések, hogy a környékbeli ügyfelek szem előtt tartsák Önöket.

Egy rövid megbeszélésen már kész anyagot tudok mutatni: az Önök vállalkozására készített weboldalt, egy működő AI automatizálást és egy közösségimédia-tervet. Akár mind a hármat, akár csak azt, amelyik érdekli.

Ha szívesen megnézné, kérem, válaszoljon erre a levélre, és küldök néhány lehetséges időpontot. Ha Önnek van megfelelő időpontja, szívesen alkalmazkodom.

Üdvözlettel:
Kálmán Tamás`, false),
      step(3, '', `Sziasztok!

Röviden a weboldalról, hátha Önöknek ez a leghasznosabb.

A legtöbb kisvállalkozás oldala az első másodpercekben elveszíti a látogatót: lassan tölt be, telefonon nehezen olvasható, és nem egyértelmű, hol lehet telefonálni vagy időpontot foglalni. Olyan oldalakat készítek, amelyek éppen ezt oldják meg, és olyan egyszerűek, hogy később saját maguk is frissíteni tudják.

Az Önök vállalkozására készített oldalt egy rövid megbeszélésen készen meg tudom mutatni. Ha szeretné látni, kérem, válaszoljon, és küldök néhány lehetséges időpontot, vagy írja meg, Önnek mikor alkalmas.

Üdvözlettel:
Kálmán Tamás`, true),
      step(4, '', `Sziasztok!

A másik terület, amelyet említettem: az AI automatizálás.

A gyakorlatban ez azt jelenti, hogy a rutinüzenetek Önök nélkül is elintéződnek. Az este kilenckor érkező érdeklődés választ kap, az időpont lefoglalódik, a nem fogadott hívás után visszajelzés megy. Önnek csak ott kell közbelépnie, ahol valóban ember kell.

Egy rövid megbeszélésen működés közben megmutatom, hogyan nézne ki ez Önöknél. Ha ez levenne némi terhet a vállukról, kérem, válaszoljon, és küldök néhány lehetséges időpontot, vagy írjon egy Önnek megfelelő időpontot.

Üdvözlettel:
Kálmán Tamás`, true),
      step(5, '', `Sziasztok!

Az utolsó levelem, a közösségi médiáról.

Megtervezem és elkészítem a rendszeres bejegyzéseket, és kisebb helyi hirdetési kampányokat futtatok, hogy a környéken élők rendszeresen találkozzanak Önökkel, és tudják, mi az újdonság. Ami megjelenik, azt Ön hagyja jóvá; a többit elvégzem.

Az Önöknek készített tervet egy rövid megbeszélésen meg tudom mutatni, akár a weboldallal és az automatizálással együtt. Ha szívesen megnézné, kérem, válaszoljon, és küldök néhány lehetséges időpontot, vagy írja meg, mikor alkalmas. Ha egyik sem érdekli, nem szükséges válaszolnia, és többet nem keresem.

Üdvözlettel:
Kálmán Tamás`, true),
    ],
  },
];
