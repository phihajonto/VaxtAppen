// Delad kod för Växtvaktens funktioner: VAPID-nycklar, utskick av en notis och svar med felmeddelanden.
import webpush from "npm:web-push@3.6.7";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type { SupabaseClient };

export const stockholmDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

// The app calls some functions straight from the browser.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const preflight = () => new Response(null, { headers: CORS });
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

// Every failure is returned as {"fel": "..."} with a plain-language reason, so the Test button and
// the cron history show what is wrong instead of only "Internal server error".
export const fail = (fel: string, detalj?: string, status = 500) => {
  console.error(fel, detalj ?? "");
  return reply({ fel, detalj }, status);
};

export const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

// Prepares web-push and returns a database client, or a Response explaining what is wrong.
export function setup(): SupabaseClient | Response {
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
  return db();
}

export type PushResult = { service: string; status: number; ok: boolean; detalj?: string };

// Sends one notification and reports what the push service (Apple, Google, Mozilla …) answered.
// Subscriptions the service says are gone (404/410) are removed.
export async function push(supabase: SupabaseClient, endpoint: string, subscription: unknown, payload: string): Promise<PushResult> {
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

// What the last morning run did, stored in app_config so the two schedulers don't both send.
export type LastRun = { day: string; at: string; source: string; households: number; sent: number };
export const LAST_RUN_KEY = "last_reminder_run";

export async function readLastRun(supabase: SupabaseClient): Promise<LastRun | null> {
  const { data } = await supabase.from("app_config").select("value").eq("key", LAST_RUN_KEY).maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch { return null; }
}
