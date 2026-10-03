(() => {
  const CFG = window.VAXTVAKTEN_CONFIG || {};
  const DAY = 86400000;
  const PIN_KEY = "vaxtvakten.pin";
  const state = { plants: [], openId: null, mode: null, confirmDelete: false, ready: false, offline: false };
  let pin = "";

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const fmt = (d, o) => new Date(d).toLocaleDateString("sv-SE", o || { day: "numeric", month: "short" });
  const fmtLong = d => new Date(d).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ---------- Supabase ---------- */
  class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", apikey: CFG.supabaseAnonKey,
          // New-style publishable keys (sb_publishable_…) go in apikey only; legacy anon keys are JWTs.
          ...(CFG.supabaseAnonKey.startsWith("sb_") ? {} : { Authorization: `Bearer ${CFG.supabaseAnonKey}` }),
        },
        body: JSON.stringify({ p_pin: pin, ...args }),
      });
    } catch { throw new ApiError("offline", "Ingen anslutning"); }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = body?.message || "";
      if (msg.includes("wrong_pin")) throw new ApiError("wrong_pin", msg);
      if (msg.includes("image_too_large")) throw new ApiError("image_too_large", msg);
      throw new ApiError("server", msg || res.statusText);
    }
    return body;
  }
  const fromRow = r => ({
    id: r.id, name: r.name, latin: r.latin, description: r.description, light: r.light,
    intervalDays: r.interval_days, lastWatered: r.last_watered, history: r.history || [], imageUrl: r.image_url,
  });
  const toRow = p => ({
    id: p.id || "", name: p.name, latin: p.latin || "", description: p.description || "", light: p.light || "",
    interval_days: p.intervalDays, last_watered: p.lastWatered || "", history: p.history || [], image_url: p.imageUrl || "",
  });

  /* One-time additions, run from the app so nobody has to touch the database by hand.
     Each runs once per device and only adds a plant that is missing. */
  const ADDITIONS = [
    { key: "kimbalafikus-2026-10", plant: {
      id: "kimbalafikus", name: "Kimbalafikus", latin: "Ficus cyathistipula", intervalDays: 8, light: "Ljust, ej direkt sol",
      imageUrl: "img/kimbalafikus.jpg", history: [], lastWatered: null,
      description: "Ficus med långa, blanka och läderartade blad längs en uppstammad stam. Vattna när översta 2–3 cm jord är torr och töm ytterkrukan efter en kvart. Den tål lite mindre ljus än många andra ficusar, men växer bäst ljust utan direkt sol.\n\nDe bruna, torra fjällen vid bladfästena är stipler, skyddsblad runt nya skott, och de faller av naturligt. Torka av bladen ibland så de kan ta upp ljus.\n\nKruka: 21 cm (från Blomsterlandet).",
    } },
  ];
  let additionsRunning = false;
  async function runAdditions() {
    if (additionsRunning) return;
    additionsRunning = true;
    try {
      for (const a of ADDITIONS) {
        const k = "vaxtvakten.added." + a.key;
        if (store.get(k)) continue;
        if (!state.plants.some(p => p.id === a.plant.id)) replacePlant(await rpc("save_plant", { p: toRow(a.plant) }));
        store.set(k, "1");
      }
    } catch {} finally { additionsRunning = false; }
  }

  async function load() {
    try {
      const rows = await rpc("list_plants", {});
      state.plants = rows.map(fromRow);
      state.ready = true; setOffline(false); render();
      runAdditions();
    } catch (e) {
      if (e.code === "wrong_pin") return lock("PIN-koden stämmer inte längre. Skriv in den nya.");
      if (e.code === "offline") setOffline(true);
      else toast("Kunde inte hämta växterna. Försök igen om en stund.");
    }
  }
  function setOffline(on) {
    state.offline = on;
    const n = $("#storeNotice");
    n.hidden = !on; n.classList.toggle("offline", on);
    if (on) n.textContent = "Ingen anslutning. Listan kan vara inaktuell, och ändringar går inte att spara förrän du är online igen.";
  }
  function replacePlant(row) {
    const p = fromRow(row);
    const i = state.plants.findIndex(x => x.id === p.id);
    if (i >= 0) state.plants[i] = p; else state.plants.push(p);
    render();
    return p;
  }

  /* ---------- schedule ---------- */
  function schedule(p) {
    const interval = Math.max(1, Number(p.intervalDays) || 7);
    if (!p.lastWatered) return { interval, daysLeft: 0, due: new Date(), never: true, pct: 0 };
    const due = new Date(startOfDay(p.lastWatered).getTime() + interval * DAY);
    const daysLeft = Math.round((due - startOfDay(new Date())) / DAY);
    const pct = Math.max(0, Math.min(1, daysLeft / interval));
    return { interval, daysLeft, due, never: false, pct };
  }
  function dueLabel(s) {
    if (s.never) return { text: "Inte vattnad än", cls: "today" };
    if (s.daysLeft < 0) { const n = -s.daysLeft; return { text: `Försenad ${n} ${n === 1 ? "dag" : "dagar"}`, cls: "due" }; }
    if (s.daysLeft === 0) return { text: "Vattna idag", cls: "today" };
    if (s.daysLeft === 1) return { text: "Vattna i morgon", cls: "" };
    return { text: `Om ${s.daysLeft} dagar`, cls: "" };
  }
  const isDue = p => schedule(p).daysLeft <= 0;
  const sorted = () => [...state.plants].sort((a, b) => schedule(a).daysLeft - schedule(b).daysLeft || String(a.name).localeCompare(String(b.name), "sv"));

  async function waterPlant(id) {
    const p = state.plants.find(x => x.id === id); if (!p) return;
    try {
      const before = { lastWatered: p.lastWatered || null, history: [...(p.history || [])] };
      const row = await rpc("water_plant", { p_id: id });
      const np = replacePlant(row);
      toast(`${np.name} vattnad. Nästa gång ${fmtLong(schedule(np).due)}.`, {
        label: "Ångra",
        run: () => restoreWatering(id, before, `Vattningen av ${np.name} är ångrad.`),
      });
    } catch (e) { toast(errText(e)); }
  }
  // Puts back an earlier watering state, e.g. after an accidental tap.
  async function restoreWatering(id, prev, doneMsg) {
    const p = state.plants.find(x => x.id === id); if (!p) return;
    try {
      replacePlant(await rpc("save_plant", { p: toRow({ ...p, lastWatered: prev.lastWatered, history: prev.history }) }));
      toast(doneMsg);
    } catch (e) { toast(errText(e)); }
  }
  function undoLatest(id) {
    const p = state.plants.find(x => x.id === id); if (!p) return;
    const history = (p.history || []).slice(1);
    return restoreWatering(id, { lastWatered: history[0] || null, history }, `Senaste vattningen av ${p.name} är borttagen.`);
  }
  function errText(e) {
    if (e?.code === "wrong_pin") { lock("PIN-koden stämmer inte längre. Skriv in den nya."); return "Fel PIN-kod."; }
    if (e?.code === "offline") return "Ingen anslutning. Försök igen när du är online.";
    if (e?.code === "image_too_large") return "Bilden är för stor. Välj en mindre bild.";
    return "Kunde inte spara. Försök igen.";
  }

  /* ---------- render ---------- */
  function cardHTML(p) {
    const s = schedule(p), l = dueLabel(s), due = s.daysLeft <= 0;
    const initial = esc((p.name || "?").trim().charAt(0).toUpperCase());
    return `<div class="card ${due ? "is-due" : ""}" role="button" tabindex="0" data-open="${esc(p.id)}">
      <div class="thumb">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : initial}</div>
      <div class="card-main">
        <div class="card-name">${esc(p.name)}</div>
        ${p.latin ? `<div class="card-latin">${esc(p.latin)}</div>` : ""}
        <div class="card-meta"><span class="pill ${l.cls}">${l.text}</span></div>
        <div class="gauge ${due ? "due" : ""}" aria-hidden="true"><span style="width:${Math.round((due ? 1 : s.pct) * 100)}%"></span></div>
      </div>
      <button class="btn ${due ? "water" : "ghost"}" type="button" data-water="${esc(p.id)}">Vattnat</button>
    </div>`;
  }

  function render() {
    $("#today").textContent = fmtLong(new Date());
    const list = sorted();
    const due = list.filter(isDue), ok = list.filter(p => !isDue(p));
    $("#dueList").innerHTML = due.map(cardHTML).join("");
    $("#okList").innerHTML = ok.map(cardHTML).join("");
    $("#dueSection").hidden = !due.length;
    $("#okSection").hidden = !ok.length;
    $("#empty").hidden = !state.ready || list.length > 0;

    const st = $("#status");
    if (!state.ready) { $("#statusBig").textContent = "Hämtar växterna …"; $("#statusSub").textContent = ""; }
    else if (!list.length) { $("#statusBig").textContent = "Lägg till en växt för att komma igång"; $("#statusSub").textContent = "Du får en lista över vad som ska vattnas, och när."; st.classList.remove("alert"); }
    else if (due.length) {
      $("#statusBig").textContent = due.length === 1 ? `${due[0].name} behöver vatten` : `${due.length} växter behöver vatten`;
      $("#statusSub").textContent = due.length === 1 ? "Tryck på Vattnat när du är klar." : due.map(p => p.name).join(", ");
      st.classList.add("alert");
    } else {
      const next = list[0], s = schedule(next);
      $("#statusBig").textContent = "Alla växter är vattnade";
      $("#statusSub").textContent = `Nästa: ${next.name}, ${fmtLong(s.due)}.`;
      st.classList.remove("alert");
    }
    document.title = due.length ? `(${due.length}) Växtvakten` : "Växtvakten";
    if ("setAppBadge" in navigator) { try { due.length ? navigator.setAppBadge(due.length) : navigator.clearAppBadge(); } catch {} }
    if (state.mode === "view") renderSheet();
  }

  function renderSheet() {
    const root = $("#sheetRoot");
    if (!state.mode) { root.innerHTML = ""; return; }
    let inner = "";
    if (state.mode === "view") {
      const p = state.plants.find(x => x.id === state.openId);
      if (!p) { closeSheet(); return; }
      const s = schedule(p), l = dueLabel(s);
      const hist = (p.history || []).slice(0, 8);
      inner = `
        <div class="sheet-top"><div><h2 id="sheetTitle">${esc(p.name)}</h2>${p.latin ? `<div class="latin">${esc(p.latin)}</div>` : ""}</div>
        <button class="close" type="button" data-action="close" aria-label="Stäng">×</button></div>
        ${p.imageUrl ? `<img class="photo" src="${esc(p.imageUrl)}" alt="${esc(p.name)}">` : `<div class="photo">Ingen bild än. Lägg till en via Redigera.</div>`}
        <div class="facts">
          <div class="fact"><div class="k">Senast</div><div class="v">${s.never ? "—" : fmt(p.lastWatered)}</div></div>
          <div class="fact ${s.daysLeft <= 0 ? "due" : ""}"><div class="k">Nästa</div><div class="v">${s.never ? "Nu" : fmt(s.due)}</div></div>
          <div class="fact"><div class="k">Intervall</div><div class="v">var ${s.interval}:e dag</div></div>
        </div>
        <div class="care"><span class="pill ${l.cls}">${l.text}</span>${p.light ? `<span class="pill example">Ljus: ${esc(p.light)}</span>` : ""}</div>
        <button class="btn water water-big" type="button" data-water="${esc(p.id)}">Vattnat</button>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : `<p class="desc" style="color:var(--muted)">Ingen beskrivning än.</p>`}
        ${hist.length ? `<div><div class="section-label">Vattnad</div><div class="history">${hist.map(h => `<span>${fmt(h, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>`).join("")}</div>
          <button class="btn ghost" type="button" data-action="undo-latest" style="margin-top:10px">Ta bort senaste vattningen</button></div>` : ""}
        ${state.confirmDelete ? `<div class="confirm"><div>Ta bort ${esc(p.name)} för gott?</div><div class="row"><button class="btn" type="button" data-action="cancel-delete">Avbryt</button><button class="btn danger" type="button" data-action="do-delete">Ta bort</button></div></div>`
          : `<div class="row"><button class="btn danger ghost" type="button" data-action="ask-delete">Ta bort</button><button class="btn" type="button" data-action="edit">Redigera</button></div>`}`;
    } else if (state.mode === "add" || state.mode === "edit") {
      const p = state.mode === "edit" ? state.plants.find(x => x.id === state.openId) || {} : {};
      inner = `
        <div class="sheet-top"><h2 id="sheetTitle">${state.mode === "edit" ? "Redigera växt" : "Ny växt"}</h2>
        <button class="close" type="button" data-action="close" aria-label="Stäng">×</button></div>
        <form id="plantForm">
          <label for="f-name">Namn<input id="f-name" name="name" required maxlength="60" value="${esc(p.name)}" placeholder="t.ex. Monstera i vardagsrummet"></label>
          <label for="f-latin">Latinskt namn <span class="hint">(valfritt)</span><input id="f-latin" name="latin" maxlength="80" value="${esc(p.latin)}" placeholder="Monstera deliciosa"></label>
          <div class="two">
            <label for="f-interval">Vattna var … dag<input id="f-interval" name="intervalDays" type="number" min="1" max="90" required value="${esc(p.intervalDays ?? 7)}"></label>
            <label for="f-light">Ljus <span class="hint">(valfritt)</span>
              <select id="f-light" name="light">
                ${["", "Soligt", "Ljust, ej direkt sol", "Halvskugga", "Skugga"].map(o => `<option value="${o}" ${o === (p.light || "") ? "selected" : ""}>${o || "—"}</option>`).join("")}
              </select></label>
          </div>
          <label for="f-last">Senast vattnad<input id="f-last" name="lastWatered" type="date" value="${p.lastWatered ? new Date(p.lastWatered).toLocaleDateString("sv-SE") : (state.mode === "add" ? new Date().toLocaleDateString("sv-SE") : "")}"></label>
          <div class="pick"><div class="thumb" id="f-preview">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="">` : "+"}</div>
            <label for="f-image">Bild <span class="hint">(valfritt)</span><input id="f-image" name="image" type="file" accept="image/*"></label></div>
          <label for="f-desc">Beskrivning<textarea id="f-desc" name="description" maxlength="2000" placeholder="Var den står, skötselråd, gödsling …">${esc(p.description)}</textarea></label>
          <div class="row"><button class="btn" type="button" data-action="close">Avbryt</button><button class="btn primary" type="submit">Spara</button></div>
        </form>`;
    } else if (state.mode === "remind") {
      inner = remindHTML();
    }
    root.innerHTML = `<div class="scrim" data-action="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">${inner}</div></div>`;
    if (state.mode === "remind") bindRemind();
  }

  function openSheet(mode, id) { state.mode = mode; state.openId = id || null; state.confirmDelete = false; renderSheet(); const f = document.querySelector("#sheetRoot input:not([type=file]), #sheetRoot .water-big"); f && f.focus({ preventScroll: true }); }
  function closeSheet() { state.mode = null; state.openId = null; state.confirmDelete = false; $("#sheetRoot").innerHTML = ""; }

  function toast(msg, action) {
    const r = $("#toastRoot");
    r.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ""}</div>`;
    if (action) r.querySelector(".toast-action").addEventListener("click", () => { r.innerHTML = ""; clearTimeout(toast.t); action.run(); });
    clearTimeout(toast.t); toast.t = setTimeout(() => (r.innerHTML = ""), action ? 8000 : 3200);
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const w = e.target.closest("[data-water]");
    if (w) { e.stopPropagation(); w.disabled = true; await waterPlant(w.dataset.water); w.disabled = false; return; }
    const a = e.target.closest("[data-action]");
    if (a) {
      const act = a.dataset.action;
      if (act === "scrim" && e.target !== a) return;
      if (act === "close" || act === "scrim") closeSheet();
      else if (act === "add") openSheet("add");
      else if (act === "edit") openSheet("edit", state.openId);
      else if (act === "undo-latest") { a.disabled = true; await undoLatest(state.openId); }
      else if (act === "ask-delete") { state.confirmDelete = true; renderSheet(); }
      else if (act === "cancel-delete") { state.confirmDelete = false; renderSheet(); }
      else if (act === "do-delete") {
        const id = state.openId, n = state.plants.find(p => p.id === id)?.name;
        try { await rpc("delete_plant", { p_id: id }); state.plants = state.plants.filter(p => p.id !== id); closeSheet(); render(); toast(`${n} borttagen.`); }
        catch (er) { toast(errText(er)); }
      }
      return;
    }
    const o = e.target.closest("[data-open]");
    if (o) openSheet("view", o.dataset.open);
  });
  $("#addBtn").addEventListener("click", () => openSheet("add"));
  $("#remindBtn").addEventListener("click", () => openSheet("remind"));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && state.mode) closeSheet();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-open]")) { e.preventDefault(); openSheet("view", e.target.dataset.open); }
  });
  document.addEventListener("change", e => {
    if (e.target.id !== "f-image" || !e.target.files[0]) return;
    const url = URL.createObjectURL(e.target.files[0]);
    $("#f-preview").innerHTML = `<img src="${url}" alt="">`;
  });
  document.addEventListener("submit", async e => {
    if (e.target.id !== "plantForm") return;
    e.preventDefault();
    const f = new FormData(e.target);
    const existing = state.mode === "edit" ? state.plants.find(x => x.id === state.openId) : null;
    const lastDate = f.get("lastWatered");
    let lastWatered = existing?.lastWatered || null;
    if (lastDate) {
      const prev = existing?.lastWatered ? new Date(existing.lastWatered).toLocaleDateString("sv-SE") : null;
      if (lastDate !== prev) lastWatered = new Date(lastDate + "T12:00:00").toISOString();
    } else lastWatered = null;
    const plant = {
      ...(existing || {}),
      name: String(f.get("name")).trim(),
      latin: String(f.get("latin") || "").trim(),
      intervalDays: Math.max(1, Math.min(90, parseInt(f.get("intervalDays"), 10) || 7)),
      light: String(f.get("light") || ""),
      description: String(f.get("description") || "").trim(),
      lastWatered,
      history: existing?.history?.length ? existing.history : (lastWatered ? [lastWatered] : []),
    };
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    const file = f.get("image");
    try {
      if (file && file.size) { btn.textContent = "Förbereder bild …"; plant.imageUrl = await shrinkImage(file); }
    } catch {
      btn.disabled = false; btn.textContent = "Spara";
      toast("Bilden gick inte att läsa. Prova en jpg- eller png-bild.");
      return;
    }
    btn.textContent = "Sparar …";
    try {
      const np = replacePlant(await rpc("save_plant", { p: toRow(plant) }));
      openSheet("view", np.id);
      toast(existing ? "Ändringarna är sparade." : `${np.name} tillagd.`);
    } catch (er) { btn.disabled = false; btn.textContent = "Spara"; toast(errText(er)); }
  });

  /* Photos are scaled down in the browser and stored with the plant. */
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      let max = 900, q = 0.8, out = "";
      for (let tries = 0; tries < 6; tries++) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q);
        if (out.length < 180000) return out;
        max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
      }
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- push notifications ---------- */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  async function currentSubscription() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  function b64ToBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new ApiError("denied", "Notiser nekade");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
    await rpc("save_subscription", { p_sub: sub.toJSON() });
  }
  async function disablePush() {
    const sub = await currentSubscription();
    if (!sub) return;
    try { await rpc("delete_subscription", { p_endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe();
  }

  function remindHTML() {
    let pushPart;
    if (isIOS && !isStandalone) {
      pushPart = `<p class="desc">På iPhone fungerar notiser bara när Växtvakten ligger på hemskärmen:</p>
        <ol class="steps"><li>Tryck på dela-knappen i Safari.</li><li>Välj <b>Lägg till på hemskärmen</b>.</li><li>Öppna Växtvakten från hemskärmen och kom tillbaka hit.</li></ol>`;
    } else if (!pushSupported) {
      pushPart = `<p class="notice">Den här webbläsaren kan inte ta emot notiser. Prova Chrome, Edge, Firefox eller Safari.</p>`;
    } else {
      pushPart = `<button class="btn primary" type="button" id="pushBtn" disabled>Kontrollerar …</button><p class="notice" id="pushMsg" hidden></p>`;
    }
    return `<div class="sheet-top"><h2 id="sheetTitle">Påminnelser</h2><button class="close" type="button" data-action="close" aria-label="Stäng">×</button></div>
      <div><h3 style="font-size:18px">Notis på den här enheten</h3>
      <p class="desc">Varje morgon får du en notis om någon växt behöver vatten, även när appen är stängd. Slå på det på varje telefon eller dator som ska få notiser.</p></div>
      ${pushPart}
      <div><h3 style="font-size:18px">Kalender</h3>
      <p class="desc">Du kan också spara en kalenderfil med en påminnelse kl. 08 för varje växt. Spara en ny fil om schemat ändras.</p></div>
      <button class="btn" type="button" id="icsBtn" ${state.plants.length ? "" : "disabled"}>Spara kalenderfil (.ics)</button>`;
  }
  async function bindRemind() {
    $("#icsBtn")?.addEventListener("click", saveIcs);
    const btn = $("#pushBtn"); if (!btn) return;
    const msg = $("#pushMsg");
    const show = t => { msg.hidden = !t; msg.textContent = t || ""; };
    const refresh = async () => {
      const on = !!(await currentSubscription().catch(() => null)) && Notification.permission === "granted";
      btn.disabled = false;
      btn.textContent = on ? "Stäng av notiser" : "Slå på notiser";
      btn.className = on ? "btn" : "btn primary";
      btn.dataset.on = on ? "1" : "";
      if (Notification.permission === "denied") { btn.disabled = true; show("Notiser är blockerade för den här sidan. Tillåt dem i webbläsarens eller telefonens inställningar."); }
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true; show("");
      try {
        if (btn.dataset.on) { await disablePush(); toast("Notiserna är avstängda."); }
        else { await enablePush(); toast("Notiser är på. Du får en påminnelse på morgonen när något behöver vatten."); }
      } catch (e) {
        show(e.code === "denied" ? "Du behöver tillåta notiser för att få påminnelser." : e.code === "offline" ? "Ingen anslutning. Försök igen när du är online." : "Det gick inte att slå på notiser. Försök igen.");
      }
      refresh();
    });
    refresh();
  }

  function saveIcs() {
    const pad = n => String(n).padStart(2, "0");
    const d8 = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const clean = s => String(s || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const ev = state.plants.map(p => {
      const s = schedule(p);
      const start = s.daysLeft < 0 || s.never ? startOfDay(new Date()) : startOfDay(s.due);
      const end = new Date(start.getTime() + DAY);
      return ["BEGIN:VEVENT", `UID:${p.id}@vaxtvakten`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d8(start)}`, `DTEND;VALUE=DATE:${d8(end)}`,
        `RRULE:FREQ=DAILY;INTERVAL=${s.interval}`, `SUMMARY:Vattna ${clean(p.name)}`,
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:Vattna ${clean(p.name)}`, "TRIGGER:PT8H", "END:VALARM", "END:VEVENT"].join("\r\n");
    });
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vaxtvakten//SV", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "vattna-vaxter.ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------- PIN ---------- */
  function lock(message) {
    store.del(PIN_KEY); pin = "";
    $("#app").hidden = true; $("#lock").hidden = false; closeSheet();
    $("#pinErr").textContent = message || "";
    setTimeout(() => $("#pinInput").focus(), 50);
  }
  async function unlock(p) {
    pin = p;
    const rows = await rpc("list_plants", {});
    store.set(PIN_KEY, p);
    state.plants = rows.map(fromRow); state.ready = true;
    $("#lock").hidden = true; $("#app").hidden = false;
    render();
    runAdditions();
  }
  $("#pinForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    $("#pinErr").textContent = "";
    try { await unlock($("#pinInput").value.trim()); $("#pinInput").value = ""; }
    catch (er) { pin = ""; $("#pinErr").textContent = er.code === "wrong_pin" ? "Fel PIN-kod. Försök igen." : er.code === "offline" ? "Ingen anslutning. Försök igen när du är online." : "Något gick fel. Försök igen om en stund."; }
    btn.disabled = false;
  });

  /* ---------- boot ---------- */
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!CFG.supabaseUrl || CFG.supabaseUrl.startsWith("DIN-")) {
    document.body.innerHTML = `<div class="lock"><div class="lock-card"><h1>Växtvakten</h1><p>Appen är inte inställd än. Fyll i config.js med uppgifterna från Supabase.</p></div></div>`;
    return;
  }
  const saved = store.get(PIN_KEY);
  if (saved) {
    pin = saved; $("#app").hidden = false; render(); load();
  } else lock();

  document.addEventListener("visibilitychange", () => { if (!document.hidden && pin) load(); });
  window.addEventListener("online", () => pin && load());
  setInterval(() => { if (!document.hidden && pin) load(); }, 60 * 1000);
})();
