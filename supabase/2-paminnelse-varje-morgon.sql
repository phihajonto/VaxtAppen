-- Växtvakten: kör påminnelsen varje morgon.
-- Kör i Supabase → SQL Editor efter att funktionen send-reminders är skapad.
-- Adressen och nyckeln är redan ifyllda för ditt projekt.
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
    url     := 'https://bpgmsbxhevlqdunoxhye.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZ21zYnhoZXZscWR1bm94aHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTA3MDcsImV4cCI6MjEwNjU4NjcwN30.GsdjLh5wzfPFjqGhVisXXjhobDRlhuZDVVFvZk-M1m8'
    ),
    body    := '{}'::jsonb
  );
  $$
);
