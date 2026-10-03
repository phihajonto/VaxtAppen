// Växtvakten: skickar en pushnotis till varje hushåll där minst en växt behöver vatten idag.
// Notisen går bara till enheter som slagit på notiser i just det hushållet.
// Körs varje morgon av ett schemalagt jobb.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const DAY = 86_400_000;
const stockholmDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:vaxtvakten@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const { data: plants, error } = await supabase
    .from("plants")
    .select("household_id, name, interval_days, last_watered");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const today = Date.parse(stockholmDate(new Date()));
  const dueByHousehold = new Map<string, string[]>();
  for (const p of plants ?? []) {
    const isDue = !p.last_watered ||
      Math.round((today - Date.parse(stockholmDate(new Date(p.last_watered)))) / DAY) >= p.interval_days;
    if (!isDue) continue;
    const names = dueByHousehold.get(p.household_id) ?? [];
    names.push(p.name);
    dueByHousehold.set(p.household_id, names);
  }
  if (!dueByHousehold.size) return Response.json({ households: 0, sent: 0 });

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, subscription, household_id")
    .in("household_id", [...dueByHousehold.keys()]);
  let sent = 0;
  for (const s of subs ?? []) {
    const names = dueByHousehold.get(s.household_id)!;
    const payload = JSON.stringify({
      title: names.length === 1 ? `Dags att vattna ${names[0]}` : `${names.length} växter behöver vatten`,
      body: names.length === 1 ? "Tryck för att öppna Växtvakten." : names.join(", "),
    });
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else {
        console.error("push failed", code, (e as Error).message);
      }
    }
  }
  return Response.json({ households: dueByHousehold.size, sent });
});
