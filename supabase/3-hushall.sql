-- Växtvakten: egna hushåll med egen kod.
-- Kör hela filen i Supabase → SQL Editor → New query → Run, EFTER 1-databas.sql.
-- Filen går att köra flera gånger. Befintliga växter och notiser flyttas till ett första hushåll,
-- och den gamla PIN-koden fortsätter att fungera som det hushållets kod.
-- Kör inte 1-databas.sql igen efter den här filen – då skrivs funktionerna tillbaka till den gamla versionen.

create extension if not exists pgcrypto with schema extensions;

-- 1. Hushåll
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 60),
  code_hash   text unique,           -- sha256 av den normaliserade koden (för koder som appen skapar)
  legacy_hash text,                  -- bcrypt av den gamla PIN-koden (bara det första hushållet)
  is_original boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.households enable row level security;

-- Det första hushållet får den gamla PIN-koden.
insert into public.households (name, legacy_hash, is_original)
select 'Vårt hem', (select value from public.app_config where key = 'pin_hash'), true
where not exists (select 1 from public.households where is_original);

-- 2. Koppla växter och notiser till hushåll
alter table public.plants             add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.push_subscriptions add column if not exists household_id uuid references public.households(id) on delete cascade;

update public.plants             set household_id = (select id from public.households where is_original) where household_id is null;
update public.push_subscriptions set household_id = (select id from public.households where is_original) where household_id is null;

alter table public.plants             alter column household_id set not null;
alter table public.push_subscriptions alter column household_id set not null;

-- Växt-id behöver bara vara unikt inom ett hushåll.
do $$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.plants'::regclass and c.contype = 'p'
    group by c.oid having count(*) = 1
  ) then
    alter table public.plants drop constraint plants_pkey;
    alter table public.plants add constraint plants_pkey primary key (household_id, id);
  end if;
end $$;

create index if not exists push_subscriptions_household_idx on public.push_subscriptions (household_id);

-- 3. Koder
-- Koder jämförs utan skillnad på stora/små bokstäver, mellanslag och bindestreck.
create or replace function public.normalize_code(p_code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.code_hash(p_code text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(normalize_code(p_code), 'sha256'), 'hex');
$$;

-- Slumpar en kod som ABCD-EFGH-JKLM (60 bitar, utan förväxlingsbara tecken som O/0 och I/1).
create or replace function public.generate_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(12);
  out text := '';
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    if i in (3, 7) then out := out || '-'; end if;
  end loop;
  return out;
end $$;

-- Hittar hushållet som koden hör till, annars felet wrong_pin.
create or replace function public.household_for(p_pin text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare hid uuid;
begin
  if normalize_code(p_pin) <> '' then
    select id into hid from households where code_hash = code_hash(p_pin);
    if hid is null then
      select id into hid from households
       where legacy_hash is not null and legacy_hash = crypt(coalesce(p_pin, ''), legacy_hash)
       limit 1;
    end if;
  end if;
  if hid is null then
    raise exception 'wrong_pin' using errcode = '28P01';
  end if;
  return hid;
end $$;

-- Behålls för bakåtkompatibilitet.
create or replace function public.check_pin(p_pin text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform household_for(p_pin);
  return true;
exception when sqlstate '28P01' then
  return false;
end $$;

create or replace function public.require_pin(p_pin text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform household_for(p_pin);
end $$;

-- 4. Hushållsfunktioner som appen anropar
create or replace function public.create_household(p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := left(trim(coalesce(p_name, '')), 60);
  c text;
begin
  if n = '' then
    raise exception 'name_required';
  end if;
  loop
    c := generate_code();
    begin
      insert into households (name, code_hash) values (n, code_hash(c));
      exit;
    exception when unique_violation then
      -- Mycket osannolikt; slumpa en ny kod.
    end;
  end loop;
  return jsonb_build_object('name', n, 'code', c);
end $$;

create or replace function public.household_info(p_pin text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  hid uuid := household_for(p_pin);
  h households;
begin
  select * into h from households where id = hid;
  return jsonb_build_object('name', h.name, 'original', h.is_original);
end $$;

create or replace function public.rename_household(p_pin text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  hid uuid := household_for(p_pin);
  n text := left(trim(coalesce(p_name, '')), 60);
  h households;
begin
  if n = '' then
    raise exception 'name_required';
  end if;
  update households set name = n where id = hid returning * into h;
  return jsonb_build_object('name', h.name, 'original', h.is_original);
end $$;

-- Ger hushållet en ny kod. Den gamla koden slutar fungera direkt för alla.
create or replace function public.new_household_code(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  hid uuid := household_for(p_pin);
  c text;
begin
  loop
    c := generate_code();
    begin
      update households set code_hash = code_hash(c), legacy_hash = null where id = hid;
      exit;
    exception when unique_violation then
    end;
  end loop;
  return jsonb_build_object('code', c);
end $$;

-- 5. Växter och notiser, nu per hushåll. Samma namn och parametrar som tidigare.
create or replace function public.list_plants(p_pin text) returns setof public.plants
language plpgsql security definer set search_path = public, extensions as $$
declare hid uuid := household_for(p_pin);
begin
  return query select * from plants where household_id = hid order by name;
end $$;

create or replace function public.water_plant(p_pin text, p_id text) returns public.plants
language plpgsql security definer set search_path = public, extensions as $$
declare
  hid uuid := household_for(p_pin);
  r plants;
begin
  update plants
     set last_watered = now(),
         history = (
           select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
           from jsonb_array_elements(jsonb_build_array(to_jsonb(now())) || history) with ordinality t(e, i)
           where i <= 12
         ),
         updated_at = now()
   where household_id = hid and id = p_id
  returning * into r;
  return r;
end $$;

create or replace function public.save_plant(p_pin text, p jsonb) returns public.plants
language plpgsql security definer set search_path = public, extensions as $$
declare
  hid uuid := household_for(p_pin);
  r plants;
begin
  if coalesce(trim(p->>'name'), '') = '' then
    raise exception 'name_required';
  end if;
  if length(coalesce(p->>'image_url', '')) > 400000 then
    raise exception 'image_too_large';
  end if;
  insert into plants (household_id, id, name, latin, description, light, interval_days, last_watered, history, image_url)
  values (
    hid,
    coalesce(nullif(p->>'id', ''), 'p' || substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
    trim(p->>'name'),
    coalesce(p->>'latin', ''),
    coalesce(p->>'description', ''),
    coalesce(p->>'light', ''),
    greatest(1, least(90, coalesce((p->>'interval_days')::int, 7))),
    nullif(p->>'last_watered', '')::timestamptz,
    coalesce(p->'history', '[]'::jsonb),
    nullif(p->>'image_url', '')
  )
  on conflict (household_id, id) do update set
    name = excluded.name, latin = excluded.latin, description = excluded.description,
    light = excluded.light, interval_days = excluded.interval_days,
    last_watered = excluded.last_watered, history = excluded.history,
    image_url = excluded.image_url, updated_at = now()
  returning * into r;
  return r;
end $$;

create or replace function public.delete_plant(p_pin text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare hid uuid := household_for(p_pin);
begin
  delete from plants where household_id = hid and id = p_id;
end $$;

-- En enhet får notiser för det hushåll den senast slog på notiser i.
create or replace function public.save_subscription(p_pin text, p_sub jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare hid uuid := household_for(p_pin);
begin
  insert into push_subscriptions (endpoint, subscription, household_id)
  values (p_sub->>'endpoint', p_sub, hid)
  on conflict (endpoint) do update set subscription = excluded.subscription, household_id = excluded.household_id;
end $$;

create or replace function public.delete_subscription(p_pin text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare hid uuid := household_for(p_pin);
begin
  delete from push_subscriptions where household_id = hid and endpoint = p_endpoint;
end $$;

-- 6. Behörigheter: appen får bara anropa funktionerna, aldrig läsa tabellerna.
revoke execute on function
  public.check_pin(text), public.require_pin(text), public.household_for(text),
  public.generate_code(), public.code_hash(text), public.normalize_code(text)
  from public, anon, authenticated;
grant execute on function
  public.list_plants(text), public.water_plant(text, text), public.save_plant(text, jsonb),
  public.delete_plant(text, text), public.save_subscription(text, jsonb), public.delete_subscription(text, text),
  public.create_household(text), public.household_info(text), public.rename_household(text, text),
  public.new_household_code(text)
  to anon, authenticated;
