# Växtvakten: så får du upp appen

Det tar ungefär 20 minuter. Båda tjänsterna är gratis. Gör det på en dator.

Mappar i paketet:

- `site/` är själva webbappen som ska upp på Netlify.
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
3. Leta upp `BYT-MIG` (steg 5 i filen) och byt ut det mot din **PIN-kod**. Använd minst 6 tecken, gärna både bokstäver och siffror. Det är den koden du och dina kompisar skriver in i appen.
4. Klicka **Run**. Det ska stå *Success*.

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

## Del 2: Webbappen (Netlify)

**Med GitHub (rekommenderas):**
1. Logga in på **app.netlify.com**.
2. Välj **Add new project → Import an existing project → GitHub** och välj repot `VaxtAppen`.
3. Netlify hittar inställningarna i `netlify.toml` själv, så du behöver inte ändra något. Klicka **Deploy**.

Varje gång koden ändras på GitHub publiceras den nya versionen automatiskt.

**Utan GitHub:**
1. Gå till **app.netlify.com/drop**.
2. Dra hela mappen **`site`** till rutan på sidan.
3. Skapa ett gratis konto när Netlify ber om det. Annars försvinner sidan efter en timme.
4. Byt namn på sidan under **Site configuration → Change site name**, till exempel `vaxtvakten-philip`. Adressen blir då **https://vaxtvakten-philip.netlify.app**.

Öppna adressen och skriv in din PIN-kod. Nu ska alla tio växterna synas.

> Ändrar du något i `site/` senare drar du in mappen igen under **Deploys** på Netlify.

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
3. Öppna Växtvakten från hemskärmen och skriv in PIN-koden.
4. Tryck **Påminnelser → Slå på notiser** och tillåt notiser.

**Android:**
1. Öppna adressen i Chrome och skriv in PIN-koden.
2. Välj gärna **Installera app** i menyn.
3. Tryck **Påminnelser → Slå på notiser** och tillåt notiser.

### Testa en notis direkt
1. I Supabase: öppna **Edge Functions → send-reminders → Test**.
2. Klicka **Send request**.

Om någon växt behöver vatten får alla som slagit på notiser en notis inom några sekunder.

---

## Dela med kompisar

Skicka **adressen och PIN-koden**. Kompisarna behöver inget konto. De kan se växterna, trycka *Vattnat* och slå på egna notiser.

**Byta PIN-kod:** Kör den här raden i Supabase → SQL Editor:

```sql
update app_config set value = extensions.crypt('NY-KOD', extensions.gen_salt('bf')) where key = 'pin_hash';
```

Alla som har den gamla koden får då skriva in den nya.

---

## Om något inte fungerar

| Problem | Lösning |
|---|---|
| Appen säger "Appen är inte inställd än" | `config.js` har inte fått adressen och nyckeln. Gör Del 1 steg 5 och dra upp `site` igen. |
| "Fel PIN-kod" fast koden är rätt | Kontrollera att du bytte ut `BYT-MIG` innan du körde `1-databas.sql`. Byt annars PIN-koden enligt ovan. |
| Ingen notis kommer | Kontrollera de tre nycklarna i Secrets och att notiser är tillåtna på telefonen. På iPhone måste appen öppnas från hemskärmen. |
| Påminnelsen körs inte på morgonen | Kontrollera i Supabase under **Integrations → Cron** att jobbet `vaxtvakten-paminnelse` finns. |
