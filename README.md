# Växtvakten

Webbapp som håller koll på när varje krukväxt ska vattnas, med pushnotiser varje morgon.

- `site/` – själva appen (HTML, CSS, JS, service worker). Publiceras av Netlify.
- `supabase/1-databas.sql` – tabeller, PIN-skyddade funktioner och växterna.
- `supabase/2-paminnelse-varje-morgon.sql` – schemalagt jobb som kör påminnelsen.
- `supabase/functions/send-reminders/` – Edge Function som skickar pushnotiser.

Installationsguide: [SÅ-HÄR-GÖR-DU.md](SÅ-HÄR-GÖR-DU.md).

`supabase/HEMLIGA-NYCKLAR.txt` ligger inte i repot. Nycklarna finns bara i Supabase → Edge Functions → Secrets.
