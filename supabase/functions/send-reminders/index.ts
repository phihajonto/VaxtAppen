// Växtvakten: skickar en pushnotis till varje hushåll där minst en växt behöver vatten idag.
// Notisen går bara till enheter som slagit på notiser i just det hushållet.
// Körs varje morgon av ett schemalagt jobb.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const DAY = 86_400_000;
const stockholmDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

// Every failure is returned as {"fel": "..."} with a plain-language reason, so the Test button and
// the cron history show what is wrong instead of only "Internal server error".
const fail = (fel: string, detalj?: string) => {
  console.error(fel, detalj ?? "");
  return Response.json({ fel, detalj }, { status: 500 });
};

Deno.serve(async () => {
  try {
    return await sendReminders();
  } catch (e) {
    return fail("Oväntat fel i send-reminders.", (e as Error)?.message ?? String(e));
  }
});

// Keys pasted into Supabase secrets often carry quotes, spaces, line breaks or "=" padding, or use
// standard base64 (+ /) instead of the URL-safe form web-push requires. Clean that up before use.
const cleanKey = (v: string) =>
  v.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, "").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// The public key is not secret: the app already ships it in site/config.js (vapidPublicKey), and the
// two must be identical. Keeping it here means a badly pasted VAPID_PUBLIC_KEY secret can't break the
// reminders. If you ever create new VAPID keys, change both places.
const VAPID_PUBLIC_KEY = "BFWdLi4fy-0HqTSXT5vKSAxVy3vPm4gk_ODE4kraAWI6Hf2rRBQstp5Pl2wOXe32Fkh57FjMm5cu8ri-ZUC9PYY";

async function sendReminders(): Promise<Response> {
  const missing = ["VAPID_PRIVATE_KEY"].filter((k) => !Deno.env.get(k));
  if (missing.length) {
    return fail(`Hemliga nycklar saknas: ${missing.join(", ")}. Lägg in dem under Edge Functions → Secrets.`);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT")?.trim().replace(/^["']+|["']+$/g, "") || "mailto:vaxtvakten@example.com",
      VAPID_PUBLIC_KEY,
      cleanKey(Deno.env.get("VAPID_PRIVATE_KEY")!),
    );
  } catch (e) {
    return fail(
      "VAPID_PRIVATE_KEY är ogiltig. Kopiera den på nytt från HEMLIGA-NYCKLAR.txt till Edge Functions → Secrets.",
      (e as Error).message,
    );
  }

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

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, subscription, household_id")
    .in("household_id", [...dueByHousehold.keys()]);
  if (subsError) return fail("Kunde inte läsa notisprenumerationerna.", subsError.message);
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
}
