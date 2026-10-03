-- Växtvakten: kör påminnelsen varje morgon.
-- Kör i Supabase → SQL Editor efter att funktionen send-reminders är skapad.
-- Byt ut DIN-PROJEKT-URL och DIN-ANON-NYCKEL (Project Settings → API).
-- 06:00 UTC är 08:00 sommartid och 07:00 vintertid i Sverige.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('vaxtvakten-paminnelse')
where exists (select 1 from cron.job where jobname = 'vaxtvakten-paminnelse');

select cron.schedule(
  'vaxtvakten-paminnelse',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'DIN-PROJEKT-URL/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer DIN-ANON-NYCKEL'
    ),
    body    := '{}'::jsonb
  );
  $$
);
