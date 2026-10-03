# VäxtAppen

En tillgänglig webbapp för att hålla koll på när dina krukväxter behöver vatten och gödning.
Appen är helt fristående – den kräver varken Claude, konto, server eller internetuppkoppling efter första besöket.

## Funktioner

- **Mina växter** – lista med status (”Vattna idag”, ”3 dagar försenad” …), sök och sortering.
- **Vattna/Gödsla nu** – ett klick uppdaterar datumet.
- **Växtguide** – inbyggda skötselråd för ~20 vanliga krukväxter som fyller i formuläret automatiskt.
- **Säkerhetskopia** – exportera/importera som JSON för att flytta mellan enheter.
- **Offline & installerbar** – PWA med service worker; kan läggas till på hemskärmen.
- **Påminnelser** – valfri webbläsarnotis när appen öppnas och någon växt behöver vatten.

All data sparas lokalt i webbläsaren (`localStorage`). Inget skickas någonstans.

## Tillgänglighet

Byggd för att uppfylla WCAG 2.1 AA:

- Semantisk HTML med landmärken, rubrikstruktur och ”Hoppa till innehållet”-länk.
- Fullt tangentbordsnavigerbar med tydlig fokusmarkering; fokus flyttas till rubriken vid vybyte.
- Alla formulärfält har etiketter; fel visas både i en felsammanfattning och vid fältet (`aria-invalid`, `aria-describedby`).
- Statusändringar (t.ex. ”Monstera är vattnad.”) läses upp av skärmläsare via `aria-live`.
- Status förmedlas med text, inte bara färg. Kontraster klarar AA i både ljust och mörkt läge.
- Inställbar textstorlek (upp till 150 %), ljust/mörkt tema, stöd för `prefers-reduced-motion` och Windows kontrastläge.
- Klickytor minst 44 × 44 px. Fungerar från 320 px bredd utan horisontell scroll.
- Testad med axe-core (inga anmärkningar).

## Köra lokalt

Det är bara statiska filer – inget byggsteg:

```sh
python3 -m http.server 8000
# öppna http://localhost:8000
```

(Det går även att öppna `index.html` direkt, men då fungerar inte offlineläget.)

## Publicera

Arbetsflödet `.github/workflows/pages.yml` publicerar appen på GitHub Pages vid push till `main`.
Aktivera under **Settings → Pages → Source: GitHub Actions**. Appen kan även läggas på vilket
statiskt webbhotell som helst (Netlify, Azure Static Web Apps, en vanlig webbserver …).
