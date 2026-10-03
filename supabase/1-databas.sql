-- Växtvakten: databas för Supabase.
-- Kör hela filen en gång i Supabase → SQL Editor → New query → Run.
-- ÄNDRA PIN-KODEN i steg 5 innan du kör.
-- Kör sedan 3-hushall.sql. Kör inte den här filen igen efter det.

-- 1. Tillägg
create extension if not exists pgcrypto with schema extensions;

-- 2. Tabeller
create table if not exists public.plants (
  id            text primary key,
  name          text not null,
  latin         text not null default '',
  description   text not null default '',
  light         text not null default '',
  interval_days int  not null default 7 check (interval_days between 1 and 90),
  last_watered  timestamptz,
  history       jsonb not null default '[]'::jsonb,
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- Ingen kommer åt tabellerna direkt. Allt går via funktionerna nedan, som kräver PIN-koden.
alter table public.plants             enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.app_config         enable row level security;

-- 3. PIN-kontroll
create or replace function public.check_pin(p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from app_config
    where key = 'pin_hash' and value = crypt(coalesce(p_pin, ''), value)
  );
$$;

create or replace function public.require_pin(p_pin text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not check_pin(p_pin) then
    raise exception 'wrong_pin' using errcode = '28P01';
  end if;
end $$;

-- 4. Funktioner som appen anropar
create or replace function public.list_plants(p_pin text) returns setof public.plants
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  return query select * from plants order by name;
end $$;

create or replace function public.water_plant(p_pin text, p_id text) returns public.plants
language plpgsql security definer set search_path = public, extensions as $$
declare r plants;
begin
  perform require_pin(p_pin);
  update plants
     set last_watered = now(),
         history = (
           select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
           from jsonb_array_elements(jsonb_build_array(to_jsonb(now())) || history) with ordinality t(e, i)
           where i <= 12
         ),
         updated_at = now()
   where id = p_id
  returning * into r;
  return r;
end $$;

create or replace function public.save_plant(p_pin text, p jsonb) returns public.plants
language plpgsql security definer set search_path = public, extensions as $$
declare r plants;
begin
  perform require_pin(p_pin);
  if coalesce(trim(p->>'name'), '') = '' then
    raise exception 'name_required';
  end if;
  if length(coalesce(p->>'image_url', '')) > 400000 then
    raise exception 'image_too_large';
  end if;
  insert into plants (id, name, latin, description, light, interval_days, last_watered, history, image_url)
  values (
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
  on conflict (id) do update set
    name = excluded.name, latin = excluded.latin, description = excluded.description,
    light = excluded.light, interval_days = excluded.interval_days,
    last_watered = excluded.last_watered, history = excluded.history,
    image_url = excluded.image_url, updated_at = now()
  returning * into r;
  return r;
end $$;

create or replace function public.delete_plant(p_pin text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  delete from plants where id = p_id;
end $$;

create or replace function public.save_subscription(p_pin text, p_sub jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  insert into push_subscriptions (endpoint, subscription)
  values (p_sub->>'endpoint', p_sub)
  on conflict (endpoint) do update set subscription = excluded.subscription;
end $$;

create or replace function public.delete_subscription(p_pin text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;

revoke execute on function public.check_pin(text), public.require_pin(text) from public, anon, authenticated;
grant execute on function
  public.list_plants(text), public.water_plant(text, text), public.save_plant(text, jsonb),
  public.delete_plant(text, text), public.save_subscription(text, jsonb), public.delete_subscription(text, text)
  to anon, authenticated;

-- 5. PIN-kod. Byt ut BYT-MIG mot din egen kod (minst 6 tecken) innan du kör.
insert into public.app_config (key, value)
values ('pin_hash', extensions.crypt('BYT-MIG', extensions.gen_salt('bf')))
on conflict (key) do update set value = excluded.value;

-- 6. Dina växter
insert into public.plants (id, name, latin, description, light, interval_days, image_url) values
  ('dracaena', 'Drakblodsträd', 'Dracaena marginata', 'Smala gröna blad med röda kanter på en kal stam. Låt översta halvan av jorden torka innan du vattnar, den tål torka bättre än för mycket vatten. Töm ytterkrukan om vatten blir stående.

Att de nedersta bladen gulnar och faller är normalt när den växer. Bruna bladspetsar brukar bero på torr luft eller kalkhaltigt vatten.', 'Ljust, ej direkt sol', 10, 'img/dracaena.jpg'),
  ('ginseng', 'Ficus Ginseng (citronfikus)', 'Ficus microcarpa ''Ginseng''', 'Bonsaiformad ficus med tjocka, knubbiga rötter. Vattna när jordytan känns torr. Den vill ha jämn fukt men aldrig stå i vatten.

Några blad har gulnat. Det är vanligt på hösten när ljuset minskar, men kan också bero på för mycket vatten eller drag från fönstret. Plocka bort gula och nedfallna blad från jorden.

Kruka: 17 cm (från Blomsterlandet).', 'Ljust, ej direkt sol', 7, 'img/ginseng.jpg'),
  ('kaktus', 'Blå kaktus', 'Cactaceae, troligen Pilosocereus', 'Pelarkaktus med blågrön stam och gula taggar. Låt jorden torka ut helt mellan vattningarna. På vintern räcker det med lite vatten ungefär var tredje till fjärde vecka. Från våren kan du vattna ungefär varannan vecka.

Det vanligaste felet är för mycket vatten. Se till att inget vatten blir stående i ytterkrukan.

Kruka: 12 cm (från Blomsterlandet). Etiketten anger bara Cactaceae (kaktus).', 'Soligt', 21, 'img/kaktus.jpg'),
  ('kalatea', 'Kalatea', 'Calathea makoyana (Goeppertia makoyana)', 'Mönstrade blad med lila undersida. Bladen viker ihop sig på kvällen och öppnar sig på morgonen. Kalatean vill ha jämnt fuktig jord och hög luftfuktighet. Använd gärna rumstempererat, avslaget vatten eftersom den är känslig för kalk.

På bilden är flera blad ihoprullade mitt på dagen. Det tyder på att den är törstig eller att luften är torr. Duscha bladen eller ställ den på ett fat med fuktiga lecakulor.

Kruka: 12 cm (från Blomsterlandet).', 'Halvskugga', 4, 'img/kalatea.jpg'),
  ('koriander', 'Koriander', 'Coriandrum sativum', 'Ört i fönstret. Koriander vill ha jämnt fuktig jord och mycket ljus. Vattna när jordytan känns torr, oftast varannan dag.

De gula bladen nere vid jorden kan du nypa bort. Klipp av de yttre stjälkarna när du skördar så växer den vidare från mitten.', 'Soligt', 2, 'img/koriander.jpg'),
  ('moclame', 'Ficus Moclame (citronfikus)', 'Ficus microcarpa ''Moclame''', 'Det stora trädet med runda, blänkande blad. Vattna när översta 3–4 cm jord är torr och töm ytterkrukan efter en kvart.

Ficus gillar inte att flyttas eller stå i drag, och tappar då gärna blad. Den står nära ett element, så håll koll på att jorden inte torkar ut för snabbt när värmen är på.

Kruka: 21 cm (från Blomsterlandet).', 'Ljust, ej direkt sol', 8, 'img/moclame.jpg'),
  ('monstera', 'Monstera', 'Monstera deliciosa', 'Ung monstera i fönstret. Vattna ordentligt när översta 2–3 cm jord är torr och häll bort vatten som blir kvar i fatet efter en kvart.

Ett och annat gult blad längst ner är normalt. Blir flera blad gula samtidigt får den troligen för mycket vatten. Ge gärna en mosspinne att klättra på när den blir större.', 'Ljust, ej direkt sol', 7, 'img/monstera.jpg'),
  ('ormbunke', 'Ormbunke (Parvati)', 'Asplenium ''Parvati''', 'Fint flikiga, ljusgröna blad. Ormbunkar vill ha jämnt fuktig jord och ska aldrig torka ut helt, men inte stå i vatten. Duscha gärna bladen eller ställ krukan på ett fat med fuktiga lecakulor, särskilt när elementen är på.

Krulliga eller bruna blad betyder oftast att den har varit för torr. Klipp bort torra blad nere vid kanten.

Odlad i Sverige (Arvidssons i Fjärås).', 'Halvskugga', 3, 'img/ormbunke.jpg'),
  ('paradistrad', 'Krassula', 'Crassula, troligen C. ovata', 'Suckulent med tjocka, köttiga blad som lagrar vatten. Låt jorden torka ut helt innan du vattnar, och vattna ännu mer sällan på vintern.

Skrynkliga blad betyder att den är törstig. Mjuka eller gula blad betyder för mycket vatten. Den mår bra av så mycket ljus som möjligt.

Kruka: 12 cm (från Blomsterlandet). Etiketten anger bara släktet Crassula.', 'Soligt', 14, 'img/paradistrad.jpg'),
  ('schefflera', 'Paraplyaralia', 'Schefflera arboricola ''Nora''', 'Bladen sitter som små paraplyer runt stammen. Vattna när översta jordlagret känns torrt och låt den inte stå i vatten. Vänd krukan ibland så den växer jämnt mot ljuset.

Tappar den blad har den oftast fått för mycket vatten eller drag från fönstret.

Kruka: 13 cm (från Blomsterlandet).', 'Ljust, ej direkt sol', 7, 'img/schefflera.jpg'),
  ('kimbalafikus', 'Kimbalafikus', 'Ficus cyathistipula', 'Ficus med långa, blanka och läderartade blad längs en uppstammad stam. Vattna när översta 2–3 cm jord är torr och töm ytterkrukan efter en kvart. Den tål lite mindre ljus än många andra ficusar, men växer bäst ljust utan direkt sol.

De bruna, torra fjällen vid bladfästena är stipler, skyddsblad runt nya skott, och de faller av naturligt. Torka av bladen ibland så de kan ta upp ljus.

Kruka: 21 cm (från Blomsterlandet).', 'Ljust, ej direkt sol', 8, 'img/kimbalafikus.jpg')
on conflict (id) do nothing;
