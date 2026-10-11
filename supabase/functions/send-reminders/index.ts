// Växtvakten: skickar en pushnotis till varje hushåll där minst en växt behöver vatten idag.
// Notisen går bara till enheter som slagit på notiser i just det hushållet.
//
// Två jobb startar funktionen varje morgon: morgonjobbet i Supabase (pg_cron, kl. 06:00 UTC) och ett
// reservjobb i GitHub Actions en halvtimme senare ({"source": "github"}). Den som kommer först
// skickar; den andra ser att dagens påminnelse redan är gjord och gör ingenting.
// {"force": true} skickar även om dagens påminnelse redan är gjord, för att testa.
import { fail, preflight, push, type PushResult, readLastRun, reply, setup, stockholmDate, LAST_RUN_KEY, type LastRun } from "../_shared/push.ts";

const DAY = 86_400_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    let body: { source?: string; force?: boolean } = {};
    try { body = await req.json(); } catch { /* the morning job sends {} or nothing */ }
    return await sendReminders(body.source === "github" ? "github" : "supabase", body.force === true);
  } catch (e) {
    return fail("Oväntat fel i send-reminders.", (e as Error)?.message ?? String(e));
  }
});

async function sendReminders(source: string, force: boolean): Promise<Response> {
  const supabase = setup();
  if (supabase instanceof Response) return supabase;

  const todayStr = stockholmDate(new Date());
  const last = await readLastRun(supabase);
  if (!force && last?.day === todayStr) {
    return reply({ skipped: true, reason: `Dagens påminnelse är redan gjord (${last.source}, ${last.at}).`, lastRun: last });
  }
  const remember = async (households: number, sent: number) => {
    const run: LastRun = { day: todayStr, at: new Date().toISOString(), source, households, sent };
    const { error } = await supabase.from("app_config").upsert({ key: LAST_RUN_KEY, value: JSON.stringify(run) });
    if (error) console.error("could not save last run", error.message);
  };

  const { data: plants, error } = await supabase
    .from("plants")
    .select("household_id, name, interval_days, last_watered");
  if (error) {
    return fail(
      error.message.includes("household_id")
        ? "Databasen saknar hushåll. Kör supabase/3-hushall.sql i SQL Editor."
        : "Kunde inte läsa växterna.",
      error.message,
    );
  }

  const today = Date.parse(todayStr);
  const dueByHousehold = new Map<string, string[]>();
  for (const p of plants ?? []) {
    const isDue = !p.last_watered ||
      Math.round((today - Date.parse(stockholmDate(new Date(p.last_watered)))) / DAY) >= p.interval_days;
    if (!isDue) continue;
    const names = dueByHousehold.get(p.household_id) ?? [];
    names.push(p.name);
    dueByHousehold.set(p.household_id, names);
  }
  if (!dueByHousehold.size) {
    await remember(0, 0);
    return reply({ source, households: 0, sent: 0 });
  }

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, subscription, household_id")
    .in("household_id", [...dueByHousehold.keys()]);
  if (subsError) return fail("Kunde inte läsa notisprenumerationerna.", subsError.message);

  const results: PushResult[] = [];
  for (const s of subs ?? []) {
    const names = dueByHousehold.get(s.household_id)!;
    results.push(await push(supabase, s.endpoint, s.subscription, JSON.stringify({
      title: names.length === 1 ? `Dags att vattna ${names[0]}` : `${names.length} växter behöver vatten`,
      body: names.length === 1 ? "Tryck för att öppna Växtvakten." : names.join(", "),
    })));
  }
  const sent = results.filter((r) => r.ok).length;
  // If every push failed, leave the day open so the backup job half an hour later tries again.
  if (sent > 0 || results.length === 0) await remember(dueByHousehold.size, sent);
  return reply({ source, households: dueByHousehold.size, sent, results });
}
