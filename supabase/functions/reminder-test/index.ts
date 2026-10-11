// Växtvakten: skickar en testnotis till en enda telefon, från knappen "Skicka via servern" i appen.
// Telefonen anges med sin endpoint, en lång hemlig adress som bara den telefonen känner till,
// så ingen annan kan skicka testnotiser till den. Skickar aldrig vanliga påminnelser.
import { fail, preflight, push, reply, setup } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    let body: { endpoint?: string; delaySeconds?: number } = {};
    try { body = await req.json(); } catch { /* handled below */ }
    if (!body.endpoint) return fail("Ingen telefon angiven.", undefined, 400);

    const supabase = setup();
    if (supabase instanceof Response) return supabase;
    const { data: sub, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, subscription")
      .eq("endpoint", body.endpoint)
      .maybeSingle();
    if (error) return fail("Kunde inte läsa notisprenumerationerna.", error.message);
    if (!sub) {
      return fail("Den här telefonen är inte registrerad för notiser. Tryck Stäng av notiser och sedan Slå på notiser.", undefined, 404);
    }

    // Lets the person lock the phone first; some phones don't show a banner while the app is open.
    const wait = Math.max(0, Math.min(15, Number(body.delaySeconds) || 0));
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
  } catch (e) {
    return fail("Oväntat fel i reminder-test.", (e as Error)?.message ?? String(e));
  }
});
