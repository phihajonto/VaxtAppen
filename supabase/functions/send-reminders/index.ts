// Växtvakten: skickar en pushnotis till varje hushåll där minst en växt behöver vatten idag.
// Notisen går bara till enheter som slagit på notiser i just det hushållet.
// Körs varje morgon av ett schemalagt jobb.
//
// Appen kan också anropa funktionen med {"test": true, "endpoint": "..."} för att skicka en
// testnotis till en enda telefon. Endpointen är en lång, hemlig adress som bara den telefonen känner
// till, så ingen annan kan skicka testnotiser till den.
import webpush from "npm:web-push@3.6.7";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const DAY = 86_400_000;
const stockholmDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

// The app calls the test mode straight from the browser.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

// Every failure is returned as {"fel": "..."} with a plain-language reason, so the Test button and
// the cron history show what is wrong instead of only "Internal server error".
const fail = (fel: string, detalj?: string, status = 500) => {
  console.error(fel, detalj ?? "");
  return reply({ fel, detalj }, status);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    let body: { test?: boolean; endpoint?: string; delaySeconds?: number } = {};
    try { body = await req.json(); } catch { /* the morning job sends {} or nothing */ }
    return body.test ? await sendTest(body.endpoint, body.delaySeconds) : await sendReminders();
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

// "high" asks Apple and Google to deliver right away, also when the phone saves battery.
const PUSH_OPTIONS = { TTL: 60 * 60 * 12, urgency: "high" as const };

function setup(): SupabaseClient | Response {
  if (!Deno.env.get("VAPID_PRIVATE_KEY")) {
    return fail("Hemliga nyckeln VAPID_PRIVATE_KEY saknas. Lägg in den under Edge Functions → Secrets.");
  }
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
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type PushResult = { service: string; status: number; ok: boolean; detalj?: string };

// Sends one notification and reports what the push service (Apple, Google, Mozilla …) answered.
// Subscriptions the service says are gone (404/410) are removed.
async function push(supabase: SupabaseClient, endpoint: string, subscription: unknown, payload: string): Promise<PushResult> {
  const service = new URL(endpoint).host;
  try {
    const res = await webpush.sendNotification(subscription as Parameters<typeof webpush.sendNotification>[0], payload, PUSH_OPTIONS);
    return { service, status: res.statusCode, ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    const status = err.statusCode ?? 0;
    if (status === 404 || status === 410) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
    console.error("push failed", service, status, err.body ?? err.message);
    return { service, status, ok: false, detalj: (err.body || err.message || "").slice(0, 300) };
  }
}

async function sendTest(endpoint?: string, delaySeconds = 0): Promise<Response> {
  if (!endpoint) return fail("Ingen telefon angiven.", undefined, 400);
  const supabase = setup();
  if (supabase instanceof Response) return supabase;

  const { data: sub, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, subscription")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) return fail("Kunde inte läsa notisprenumerationerna.", error.message);
  if (!sub) {
    return fail("Den här telefonen är inte registrerad för notiser. Tryck Stäng av notiser och sedan Slå på notiser.", undefined, 404);
  }

  // Lets the person lock the phone first; some phones don't show a banner while the app is open.
  const wait = Math.max(0, Math.min(15, Number(delaySeconds) || 0));
  if (wait) await new Promise((r) => setTimeout(r, wait * 1000));

  const result = await push(supabase, sub.endpoint, sub.subscription, JSON.stringify({
    title: "Testnotis från Växtvakten",
    body: "Notiserna fungerar på den här telefonen.",
    tag: "vaxtvakten-test",
  }));
  if (!result.ok) {
    const why = result.status === 403
      ? "Push-tjänsten godkände inte nyckeln. VAPID_PRIVATE_KEY hör inte ihop med appens publika nyckel."
      : result.status === 404 || result.status === 410
      ? "Telefonens registrering har gått ut. Tryck Slå på notiser igen."
      : "Push-tjänsten tog inte emot notisen.";
    return reply({ fel: why, ...result }, 502);
  }
  return reply(result);
}

async function sendReminders(): Promise<Response> {
  const supabase = setup();
  if (supabase instanceof Response) return supabase;

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
  if (!dueByHousehold.size) return reply({ households: 0, sent: 0 });

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
  return reply({ households: dueByHousehold.size, sent: results.filter((r) => r.ok).length, results });
}
