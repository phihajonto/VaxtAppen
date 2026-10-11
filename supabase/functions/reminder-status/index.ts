// Växtvakten: berättar när morgonpåminnelsen senast kördes. Appen visar en varning om det dröjt.
// Läser bara; skickar aldrig några notiser.
import { db, fail, preflight, readLastRun, reply, stockholmDate } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    return reply({ today: stockholmDate(new Date()), lastRun: await readLastRun(db()) });
  } catch (e) {
    return fail("Kunde inte läsa när påminnelsen senast kördes.", (e as Error)?.message ?? String(e));
  }
});
