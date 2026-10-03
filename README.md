# Växtvakten

Webbapp som håller koll på när varje krukväxt ska vattnas, med pushnotiser varje morgon.

- `site/` – själva appen (HTML, CSS, JS, service worker). Publiceras automatiskt på GitHub Pages: **https://phihajonto.github.io/VaxtAppen/**
- `supabase/1-databas.sql` – tabeller, PIN-skyddade funktioner och växterna.
- `supabase/2-paminnelse-varje-morgon.sql` – schemalagt jobb som kör påminnelsen.
- `supabase/3-hushall.sql` – egna hushåll: varje hushåll får en egen kod, egna växter och egna påminnelser.
- `supabase/functions/send-reminders/` – Edge Function som skickar pushnotiser till varje hushåll om dess egna växter.

Installationsguide: [SÅ-HÄR-GÖR-DU.md](SÅ-HÄR-GÖR-DU.md).

`supabase/HEMLIGA-NYCKLAR.txt` ligger inte i repot. Nycklarna finns bara i Supabase → Edge Functions → Secrets.
