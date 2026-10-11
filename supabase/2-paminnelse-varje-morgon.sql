-- Växtvakten: kör påminnelsen varje morgon.
-- Körs automatiskt från GitHub när filen ändras på main (.github/workflows/supabase-sql.yml).
-- Går också att köra för hand i Supabase → SQL Editor. Filen går att köra flera gånger.
-- Adressen och nyckeln är redan ifyllda för ditt projekt.
-- Påminnelsen ska gå ut kl. 07 svensk tid året runt. pg_cron räknar i UTC, så jobbet körs både
-- 05:00 och 06:00 UTC (07:00 sommartid respektive vintertid). Funktionen skickar bara när klockan
-- är 07 eller senare i Sverige, och bara en gång per dag.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('vaxtvakten-paminnelse')
where exists (select 1 from cron.job where jobname = 'vaxtvakten-paminnelse');

select cron.schedule(
  'vaxtvakten-paminnelse',
  '0 5,6 * * *',
  $$
  select net.http_post(
    url     := 'https://bpgmsbxhevlqdunoxhye.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZ21zYnhoZXZscWR1bm94aHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTA3MDcsImV4cCI6MjEwNjU4NjcwN30.GsdjLh5wzfPFjqGhVisXXjhobDRlhuZDVVFvZk-M1m8'
    ),
    body    := '{}'::jsonb
  );
  $$
);
