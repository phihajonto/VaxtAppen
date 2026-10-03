// Växtvakten: skickar en pushnotis till alla som slagit på notiser
// när minst en växt behöver vatten idag. Körs varje morgon av ett schemalagt jobb.
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
    .select("name, interval_days, last_watered");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const today = Date.parse(stockholmDate(new Date()));
  const due = (plants ?? []).filter((p) => {
    if (!p.last_watered) return true;
    const last = Date.parse(stockholmDate(new Date(p.last_watered)));
    return Math.round((today - last) / DAY) >= p.interval_days;
  });
  if (!due.length) return Response.json({ due: 0, sent: 0 });

  const names = due.map((p) => p.name);
  const payload = JSON.stringify({
    title: due.length === 1 ? `Dags att vattna ${names[0]}` : `${due.length} växter behöver vatten`,
    body: due.length === 1 ? "Tryck för att öppna Växtvakten." : names.join(", "),
  });

  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, subscription");
  let sent = 0;
  for (const s of subs ?? []) {
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
  return Response.json({ due: due.length, sent });
});
