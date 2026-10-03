# Växtvakten: så får du upp appen

Det tar ungefär 20 minuter. Båda tjänsterna är gratis. Gör det på en dator.

Mappar i paketet:

- `site/` är själva webbappen. Den publiceras automatiskt på GitHub Pages.
- `supabase/` innehåller databasen, påminnelsefunktionen och de hemliga nycklarna.

---

## Del 1: Databasen (Supabase)

### 1. Skapa projekt
1. Gå till **supabase.com** och klicka **Start your project**. Logga in med GitHub eller e-post.
2. Klicka **New project**.
   - **Name:** `vaxtvakten`
   - **Database password:** välj ett lösenord och spara det någonstans.
   - **Region:** *North EU (Stockholm)*
3. Klicka **Create new project** och vänta någon minut tills projektet är klart.

### 2. Skapa tabellerna och lägg in dina växter
1. Klicka **SQL Editor** i vänstermenyn och sedan **New query**.
2. Öppna filen `supabase/1-databas.sql`, kopiera allt och klistra in.
3. Leta upp `BYT-MIG` (steg 5 i filen) och byt ut det mot din **PIN-kod**. Använd minst 6 tecken, gärna både bokstäver och siffror. Det blir koden till ert hushåll.
4. Klicka **Run**. Det ska stå *Success*.

### 2b. Slå på hushåll
1. Öppna **SQL Editor → New query** igen.
2. Klistra in allt från `supabase/3-hushall.sql` och klicka **Run**.

Nu kan varje hushåll ha en egen kod och egna växter. Växterna från steg 2 hamnar i ert hushåll, och PIN-koden blir ert hushålls kod.

> Kör inte `1-databas.sql` igen efter det här steget.

### 3. Skapa påminnelsefunktionen
1. Klicka **Edge Functions** i vänstermenyn.
2. Klicka **Deploy a new function** och välj **Via Editor**.
3. Döp funktionen till exakt `send-reminders`.
4. Ta bort exempelkoden. Klistra in allt från `supabase/functions/send-reminders/index.ts`.
5. Klicka **Deploy function**.

### 4. Lägg in de hemliga nycklarna
1. Gå till **Edge Functions → Secrets**. Den finns också under Project Settings.
2. Lägg till de tre nycklarna från `supabase/HEMLIGA-NYCKLAR.txt`, en i taget:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`. Skriv `mailto:` följt av din e-postadress.
3. Klicka **Save**.

### 5. Hämta adressen och nyckeln till appen
1. Gå till **Project Settings → API Keys**. På vissa ställen heter det **Data API**.
2. Kopiera **Project URL**. Den ser ut som `https://abcdefgh.supabase.co`.
3. Kopiera **anon public**-nyckeln. Den börjar med `eyJ…` och finns under fliken **Legacy API Keys**.

Båda är publika och får synas i appen. Skicka dem till Claude, så fyller Claude i resten. Du kan också göra det själv:

- Öppna `site/config.js` och ersätt `DIN-PROJEKT-URL` och `DIN-ANON-NYCKEL`.
- Öppna `supabase/2-paminnelse-varje-morgon.sql` och ersätt samma två saker där.

---

## Del 2: Webbappen (GitHub Pages)

Appen publiceras automatiskt från mappen `site/` varje gång något ändras på `main`. Du behöver inte göra något.

Adressen är **https://phihajonto.github.io/VaxtAppen/**. Den som använder appen behöver inget konto – bara adressen och sitt hushålls kod.

Öppna adressen och skriv in er kod. Nu ska alla växterna synas.

> Vill du ändå använda Netlify fungerar `netlify.toml` fortfarande, men det behövs inte.

---

## Del 3: Påminnelse varje morgon

1. Gå tillbaka till Supabase och öppna **SQL Editor → New query**.
2. Klistra in `supabase/2-paminnelse-varje-morgon.sql`. Adressen och nyckeln måste vara ifyllda.
3. Klicka **Run**.

Nu körs påminnelsen kl. 08 på sommaren och kl. 07 på vintern. En notis skickas bara de dagar någon växt behöver vatten.

---

## Del 4: Slå på notiser på telefonen

**iPhone** (kräver iOS 16.4 eller senare):
1. Öppna appens adress i **Safari**.
2. Tryck på dela-knappen och välj **Lägg till på hemskärmen**.
3. Öppna Växtvakten från hemskärmen och skriv in hushållets kod.
4. Tryck **Påminnelser → Slå på notiser** och tillåt notiser.

**Android:**
1. Öppna adressen i Chrome och skriv in hushållets kod.
2. Välj gärna **Installera app** i menyn.
3. Tryck **Påminnelser → Slå på notiser** och tillåt notiser.

### Testa en notis direkt
1. I Supabase: öppna **Edge Functions → send-reminders → Test**.
2. Klicka **Send request**.

Om någon växt behöver vatten får alla som slagit på notiser en notis inom några sekunder.

---

## Hushåll och koder

Varje hushåll har en egen kod och en egen lista med växter. Påminnelserna gäller bara det egna hushållets växter.

**Bjuda in någon ni bor med:** Tryck **Hushåll → Dela kod** i appen. Det skickar en länk som fyller i koden automatiskt. Alla med koden ser samma växter och kan vattna, ändra och ta bort dem.

**Kompisar som vill ha egna växter:** Skicka bara adressen, inte er kod. De trycker **Skapa ett eget hushåll** på startsidan och får en egen kod.

**Byta kod:** Tryck **Hushåll → Byt kod**. Den gamla koden slutar fungera direkt, och alla i hushållet behöver skriva in den nya. Gör det gärna en gång om ni har använt en enkel PIN-kod, eftersom appens egna koder är mycket svårare att gissa.

**Byta hushåll på en telefon:** Tryck **Hushåll → Logga ut**. Telefonens notiser stängs av för det gamla hushållet. Slå på dem igen efter att du har skrivit in den nya koden.

---

## Om något inte fungerar

| Problem | Lösning |
|---|---|
| Appen säger "Appen är inte inställd än" | `config.js` har inte fått adressen och nyckeln. Gör Del 1 steg 5 och spara ändringen på GitHub. |
| "Den koden finns inte" fast koden är rätt | Har någon bytt kod under **Hushåll → Byt kod**? Fråga efter den nya. För det första hushållet: kontrollera att du bytte ut `BYT-MIG` innan du körde `1-databas.sql`. |
| "Det går inte att skapa hushåll än" | Kör `supabase/3-hushall.sql` enligt Del 1 steg 2b. |
| Ingen notis kommer | Kontrollera de tre nycklarna i Secrets och att notiser är tillåtna på telefonen. På iPhone måste appen öppnas från hemskärmen. |
| Påminnelsen körs inte på morgonen | Kontrollera i Supabase under **Integrations → Cron** att jobbet `vaxtvakten-paminnelse` finns. |
