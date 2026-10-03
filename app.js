(() => {
  "use strict";

  const PLANTS_KEY = "vaxtappen.plants.v1";
  const SETTINGS_KEY = "vaxtappen.settings.v1";
  const LIBRARY = window.PLANT_LIBRARY || [];
  const VIEWS = {
    "mina-vaxter": "Mina växter",
    "lagg-till": "Lägg till växt",
    "vaxtguide": "Växtguide",
    "installningar": "Inställningar"
  };
  const LIGHT_LABELS = {
    skugga: "Skugga",
    halvskugga: "Halvskugga",
    ljust: "Ljust, ej direkt sol",
    sol: "Direkt sol"
  };

  const $ = (sel) => document.querySelector(sel);

  // ---------- Lagring ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      announce("Kunde inte spara. Webbläsaren tillåter kanske inte lagring.");
      return false;
    }
  }

  let plants = load(PLANTS_KEY, []);
  let settings = Object.assign({ theme: "auto", fontSize: "100", lastNotified: "" }, load(SETTINGS_KEY, {}));
  const savePlants = () => save(PLANTS_KEY, plants);
  const saveSettings = () => save(SETTINGS_KEY, settings);

  // ---------- Datum ----------
  function todayISO() {
    const d = new Date();
    return isoDate(d);
  }
  function isoDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function parseISO(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function daysUntil(iso) {
    return Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  }
  function formatDate(iso) {
    return parseISO(iso).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "long" });
  }

  // Returnerar status för en skötselåtgärd (vattning eller gödning)
  function careStatus(last, interval) {
    if (!interval) return null;
    if (!last) return { status: "unknown", days: Infinity, unknown: true };
    const next = addDays(last, interval);
    const days = daysUntil(next);
    return { status: days < 0 ? "overdue" : days === 0 ? "today" : "ok", days, next };
  }

  const isDue = (s) => !!s && (s.status === "overdue" || s.status === "today");

  function statusText(s, verb) {
    if (s.unknown) return `${verb} – senaste datum saknas`;
    if (s.days < 0) {
      const n = -s.days;
      return `${verb} – ${n} ${n === 1 ? "dag" : "dagar"} försenad`;
    }
    if (s.days === 0) return `${verb} idag`;
    if (s.days === 1) return `${verb} imorgon`;
    return `${verb} om ${s.days} dagar`;
  }

  // ---------- Skärmläsarmeddelanden ----------
  const announcer = $("#announcer");
  function announce(msg) {
    announcer.textContent = "";
    // Kort fördröjning så att samma text läses upp igen
    setTimeout(() => { announcer.textContent = msg; }, 50);
  }

  // ---------- Navigering ----------
  function currentView() {
    const id = location.hash.slice(1);
    return VIEWS[id] ? id : "mina-vaxter";
  }

  function showView(id, { focus = true } = {}) {
    for (const key of Object.keys(VIEWS)) {
      $(`#view-${key}`).hidden = key !== id;
    }
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.view === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    let title = VIEWS[id];
    if (id === "lagg-till" && $("#plant-id").value) title = "Redigera växt";
    document.title = `${title} – VäxtAppen`;
    if (id === "mina-vaxter") renderPlants();
    if (focus) {
      const h = $(`#view-${id} h2`);
      if (h) h.focus();
    }
  }

  window.addEventListener("hashchange", () => {
    if (currentView() !== "lagg-till") resetForm();
    showView(currentView());
  });

  // ---------- Rendera växtlista ----------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function sortKey(p) {
    const w = careStatus(p.lastWatered, p.waterInterval);
    const f = careStatus(p.lastFed, p.feedInterval);
    return Math.min(w ? w.days : Infinity, f ? f.days : Infinity);
  }

  function renderPlants() {
    const list = $("#plant-list");
    const query = $("#search").value.trim().toLowerCase();
    const sort = $("#sort").value;

    let shown = plants.filter((p) =>
      !query || [p.name, p.species, p.location].some((v) => (v || "").toLowerCase().includes(query))
    );
    const collator = new Intl.Collator("sv");
    if (sort === "name") shown.sort((a, b) => collator.compare(a.name, b.name));
    else if (sort === "location") shown.sort((a, b) => collator.compare(a.location || "~", b.location || "~") || collator.compare(a.name, b.name));
    else shown.sort((a, b) => sortKey(a) - sortKey(b) || collator.compare(a.name, b.name));

    list.replaceChildren(...shown.map(plantCard));

    $("#empty-state").hidden = plants.length > 0;
    list.hidden = plants.length === 0;

    const due = plants.filter((p) => {
      const w = careStatus(p.lastWatered, p.waterInterval);
      const f = careStatus(p.lastFed, p.feedInterval);
      return isDue(w) || isDue(f);
    }).length;

    let summary = "";
    if (plants.length) {
      summary = `${plants.length} ${plants.length === 1 ? "växt" : "växter"}. `;
      summary += due ? `${due} behöver skötsel idag.` : "Alla är omhändertagna.";
      if (query) summary += ` Visar ${shown.length} som matchar sökningen.`;
    }
    $("#summary").textContent = summary;
    updateLocationList();
  }

  function plantCard(p) {
    const w = careStatus(p.lastWatered, p.waterInterval);
    const f = careStatus(p.lastFed, p.feedInterval);
    const worst = [w, f].filter(Boolean).map((s) => s.status);
    const status = worst.includes("overdue") ? "overdue" : worst.includes("today") ? "today" : "ok";
    const headingId = `plant-${p.id}-name`;

    const meta = [p.species, p.location, p.light && LIGHT_LABELS[p.light]].filter(Boolean).join(" · ");

    const badges = el("ul", { class: "badges", role: "list" });
    if (w) badges.append(el("li", { class: `badge ${w.status}`, text: statusText(w, "Vattna") }));
    if (f) badges.append(el("li", { class: `badge ${f.status}`, text: statusText(f, "Gödsla") }));

    const details = [];
    if (p.lastWatered) details.push(`Senast vattnad ${formatDate(p.lastWatered)}`);
    if (p.lastFed) details.push(`senast gödslad ${formatDate(p.lastFed)}`);

    const actions = el("div", { class: "actions" },
      el("button", {
        type: "button", class: "button primary small",
        "aria-label": `Vattna ${p.name} nu`,
        onclick: () => markCare(p.id, "lastWatered", `${p.name} är vattnad.`)
      }, "Vattna nu"),
      p.feedInterval ? el("button", {
        type: "button", class: "button small",
        "aria-label": `Gödsla ${p.name} nu`,
        onclick: () => markCare(p.id, "lastFed", `${p.name} är gödslad.`)
      }, "Gödsla nu") : null,
      el("button", {
        type: "button", class: "button small",
        "aria-label": `Redigera ${p.name}`,
        onclick: () => editPlant(p.id)
      }, "Redigera"),
      el("button", {
        type: "button", class: "button small danger",
        "aria-label": `Ta bort ${p.name}`,
        onclick: () => deletePlant(p.id)
      }, "Ta bort")
    );

    return el("li", {},
      el("article", { class: "plant-card", "data-status": status, "aria-labelledby": headingId },
        el("h3", { id: headingId, text: p.name }),
        meta ? el("p", { class: "plant-meta", text: meta }) : null,
        badges,
        details.length ? el("p", { class: "hint", text: details.join(", ") + "." }) : null,
        p.notes ? el("p", { class: "plant-notes", text: p.notes }) : null,
        actions
      )
    );
  }

  function markCare(id, field, msg) {
    const p = plants.find((x) => x.id === id);
    if (!p) return;
    p[field] = todayISO();
    savePlants();
    renderPlants();
    announce(msg);
    // Behåll fokus på samma kort efter omritning
    const heading = document.getElementById(`plant-${id}-name`);
    const btn = heading && heading.closest("article").querySelector("button");
    if (btn) btn.focus();
  }

  async function deletePlant(id) {
    const p = plants.find((x) => x.id === id);
    if (!p) return;
    const ok = await confirmDialog(`Vill du ta bort ”${p.name}”? Det går inte att ångra.`, "Ta bort");
    if (!ok) return;
    plants = plants.filter((x) => x.id !== id);
    savePlants();
    renderPlants();
    announce(`${p.name} har tagits bort.`);
    $("#h-mina-vaxter").focus();
  }

  function updateLocationList() {
    const locs = [...new Set(plants.map((p) => p.location).filter(Boolean))].sort();
    $("#location-list").replaceChildren(...locs.map((l) => el("option", { value: l })));
  }

  // ---------- Formulär ----------
  const form = $("#plant-form");
  const fields = {
    id: $("#plant-id"),
    name: $("#name"),
    species: $("#species"),
    location: $("#location"),
    waterInterval: $("#water-interval"),
    lastWatered: $("#last-watered"),
    feedInterval: $("#feed-interval"),
    lastFed: $("#last-fed"),
    light: $("#light"),
    notes: $("#notes")
  };

  $("#species-list").replaceChildren(...LIBRARY.map((l) => el("option", { value: l.species })));

  function resetForm() {
    form.reset();
    fields.id.value = "";
    fields.lastWatered.value = todayISO();
    fields.lastWatered.max = todayISO();
    fields.lastFed.max = todayISO();
    clearErrors();
    $("#h-form").textContent = "Lägg till växt";
    $("#submit-btn").textContent = "Spara växt";
  }

  function fillFromLibrary(entry, { overwrite = false } = {}) {
    if (!entry) return;
    if (overwrite || !fields.waterInterval.value) fields.waterInterval.value = entry.water;
    if (overwrite || !fields.feedInterval.value) fields.feedInterval.value = entry.feed;
    if (overwrite || !fields.light.value) fields.light.value = entry.light;
    if (overwrite || !fields.notes.value) fields.notes.value = entry.tips;
  }

  fields.species.addEventListener("change", () => {
    const entry = LIBRARY.find((l) => l.species === fields.species.value);
    if (entry) {
      fillFromLibrary(entry);
      announce(`Skötselråd för ${entry.species} har fyllts i.`);
    }
  });

  function editPlant(id) {
    const p = plants.find((x) => x.id === id);
    if (!p) return;
    resetForm();
    for (const [k, input] of Object.entries(fields)) input.value = p[k] ?? "";
    $("#h-form").textContent = `Redigera ${p.name}`;
    $("#submit-btn").textContent = "Spara ändringar";
    if (location.hash === "#lagg-till") showView("lagg-till");
    else location.hash = "lagg-till";
  }

  function clearErrors() {
    $("#form-errors").hidden = true;
    $("#form-errors").replaceChildren();
    form.querySelectorAll("[aria-invalid]").forEach((i) => {
      i.removeAttribute("aria-invalid");
      const errId = `${i.id}-error`;
      const desc = (i.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== errId);
      if (desc.length) i.setAttribute("aria-describedby", desc.join(" "));
      else i.removeAttribute("aria-describedby");
      document.getElementById(errId)?.remove();
    });
  }

  function validate() {
    const errors = [];
    if (!fields.name.value.trim()) errors.push([fields.name, "Ange ett namn på växten."]);
    const wi = Number(fields.waterInterval.value);
    if (!fields.waterInterval.value || !Number.isInteger(wi) || wi < 1 || wi > 365)
      errors.push([fields.waterInterval, "Ange hur ofta växten ska vattnas, ett heltal mellan 1 och 365 dagar."]);
    const fi = fields.feedInterval.value;
    if (fi && (!Number.isInteger(Number(fi)) || Number(fi) < 0 || Number(fi) > 365))
      errors.push([fields.feedInterval, "Gödslingsintervallet ska vara ett heltal mellan 0 och 365 dagar."]);
    for (const f of [fields.lastWatered, fields.lastFed]) {
      if (f.value && f.value > todayISO()) errors.push([f, "Datumet kan inte ligga i framtiden."]);
    }
    return errors;
  }

  function showErrors(errors) {
    const box = $("#form-errors");
    box.replaceChildren(
      el("h3", { text: errors.length === 1 ? "Det finns ett fel i formuläret" : `Det finns ${errors.length} fel i formuläret` }),
      el("ul", {}, ...errors.map(([input, msg]) =>
        el("li", {}, el("a", { href: `#${input.id}`, onclick: (e) => { e.preventDefault(); input.focus(); } }, msg))
      ))
    );
    for (const [input, msg] of errors) {
      input.setAttribute("aria-invalid", "true");
      const errId = `${input.id}-error`;
      const err = el("p", { id: errId, class: "error-text", text: msg });
      input.closest(".field").append(err);
      const desc = (input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
      input.setAttribute("aria-describedby", [errId, ...desc].join(" "));
    }
    box.hidden = false;
    box.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors();
    const errors = validate();
    if (errors.length) return showErrors(errors);

    const data = {
      name: fields.name.value.trim(),
      species: fields.species.value.trim(),
      location: fields.location.value.trim(),
      waterInterval: Number(fields.waterInterval.value),
      lastWatered: fields.lastWatered.value || "",
      feedInterval: Number(fields.feedInterval.value) || 0,
      lastFed: fields.lastFed.value || "",
      light: fields.light.value,
      notes: fields.notes.value.trim()
    };

    const id = fields.id.value;
    if (id) {
      Object.assign(plants.find((p) => p.id === id), data);
    } else {
      plants.push({ id: newId(), ...data });
    }
    savePlants();
    announce(id ? `Ändringarna för ${data.name} är sparade.` : `${data.name} har lagts till.`);
    location.hash = "mina-vaxter";
  });

  $("#cancel-btn").addEventListener("click", () => {
    location.hash = "mina-vaxter";
  });

  function newId() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }

  // ---------- Växtguide ----------
  function renderGuide() {
    const q = $("#guide-search").value.trim().toLowerCase();
    const items = LIBRARY.filter((l) => !q || l.species.toLowerCase().includes(q) || l.tips.toLowerCase().includes(q));
    const list = $("#guide-list");
    if (!items.length) {
      list.replaceChildren(el("li", { class: "empty", text: "Inga växter matchar sökningen." }));
      return;
    }
    list.replaceChildren(...items.map((l, i) => {
      const hid = `guide-${i}`;
      return el("li", {},
        el("article", { class: "guide-card", "aria-labelledby": hid },
          el("h3", { id: hid, text: l.species }),
          el("dl", {},
            el("dt", { text: "Vattna" }), el("dd", { text: `ungefär var ${l.water}:e dag` }),
            el("dt", { text: "Gödsla" }), el("dd", { text: `ungefär var ${l.feed}:e dag under växtsäsong` }),
            el("dt", { text: "Ljus" }), el("dd", { text: LIGHT_LABELS[l.light] })
          ),
          el("p", { text: l.tips }),
          el("button", {
            type: "button", class: "button small",
            "aria-label": `Lägg till ${l.species} bland mina växter`,
            onclick: () => {
              resetForm();
              fields.species.value = l.species;
              fields.name.value = l.species.split(" (")[0];
              fillFromLibrary(l, { overwrite: true });
              location.hash = "lagg-till";
            }
          }, "Lägg till bland mina växter")
        )
      );
    }));
  }
  $("#guide-search").addEventListener("input", renderGuide);

  // ---------- Inställningar ----------
  function applySettings() {
    const root = document.documentElement;
    if (settings.theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
    root.style.setProperty("--scale", Number(settings.fontSize) / 100);
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === settings.theme; });
    $("#font-size").value = settings.fontSize;
  }

  document.querySelectorAll('input[name="theme"]').forEach((r) =>
    r.addEventListener("change", () => {
      settings.theme = r.value;
      saveSettings();
      applySettings();
    })
  );
  $("#font-size").addEventListener("change", (e) => {
    settings.fontSize = e.target.value;
    saveSettings();
    applySettings();
    announce("Textstorleken är ändrad.");
  });

  // Notiser
  function updateNotifyStatus() {
    const status = $("#notify-status");
    const btn = $("#notify-btn");
    if (!("Notification" in window)) {
      status.textContent = "Din webbläsare stöder inte notiser.";
      btn.disabled = true;
    } else if (Notification.permission === "granted") {
      status.textContent = "Notiser är aktiverade.";
      btn.disabled = true;
    } else if (Notification.permission === "denied") {
      status.textContent = "Notiser är blockerade i webbläsarens inställningar.";
      btn.disabled = true;
    } else {
      status.textContent = "";
    }
  }
  $("#notify-btn").addEventListener("click", async () => {
    await Notification.requestPermission();
    updateNotifyStatus();
    announce($("#notify-status").textContent);
    maybeNotify();
  });

  function maybeNotify() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (settings.lastNotified === todayISO()) return;
    const due = plants.filter((p) => {
      const w = careStatus(p.lastWatered, p.waterInterval);
      return isDue(w);
    });
    if (!due.length) return;
    const names = due.slice(0, 3).map((p) => p.name).join(", ") + (due.length > 3 ? " m.fl." : "");
    try {
      new Notification("Dags att vattna", { body: names, icon: "icon.svg" });
      settings.lastNotified = todayISO();
      saveSettings();
    } catch { /* Vissa mobila webbläsare kräver service worker för notiser */ }
  }

  // Export / import
  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "VaxtAppen", version: 1, plants }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `vaxtappen-${todayISO()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Säkerhetskopian har laddats ner.");
  });

  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.plants;
      if (!Array.isArray(incoming)) throw new Error("format");
      const valid = incoming
        .filter((p) => p && typeof p.name === "string" && Number(p.waterInterval) > 0)
        .map((p) => ({
          id: typeof p.id === "string" ? p.id : newId(),
          name: p.name,
          species: String(p.species || ""),
          location: String(p.location || ""),
          waterInterval: Number(p.waterInterval),
          lastWatered: /^\d{4}-\d{2}-\d{2}$/.test(p.lastWatered) ? p.lastWatered : "",
          feedInterval: Number(p.feedInterval) || 0,
          lastFed: /^\d{4}-\d{2}-\d{2}$/.test(p.lastFed) ? p.lastFed : "",
          light: LIGHT_LABELS[p.light] ? p.light : "",
          notes: String(p.notes || "")
        }));
      const byId = new Map(plants.map((p) => [p.id, p]));
      for (const p of valid) byId.set(p.id, p);
      plants = [...byId.values()];
      savePlants();
      announce(`${valid.length} ${valid.length === 1 ? "växt" : "växter"} har importerats.`);
    } catch {
      announce("Filen kunde inte läsas. Kontrollera att det är en säkerhetskopia från VäxtAppen.");
    }
  });

  $("#clear-btn").addEventListener("click", async () => {
    if (!plants.length) return announce("Det finns inga växter att ta bort.");
    const ok = await confirmDialog(`Vill du ta bort alla ${plants.length} växter? Det går inte att ångra. Exportera gärna en säkerhetskopia först.`, "Ta bort alla");
    if (!ok) return;
    plants = [];
    savePlants();
    announce("Alla växter har tagits bort.");
  });

  // ---------- Bekräftelsedialog ----------
  function confirmDialog(text, okLabel) {
    const dlg = $("#confirm-dialog");
    if (typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(text));
    const opener = document.activeElement;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel;
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => {
        resolve(dlg.returnValue === "ok");
        if (opener && opener.isConnected) opener.focus();
      }, { once: true });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }

  // ---------- Övrigt ----------
  $("#search").addEventListener("input", renderPlants);
  $("#sort").addEventListener("change", renderPlants);

  // Länkar med data-view (t.ex. i tomt läge) går via hash-navigering
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-view]");
    if (a && location.hash === `#${a.dataset.view}`) {
      e.preventDefault();
      showView(a.dataset.view);
    }
  });

  // Synka om data ändras i en annan flik
  window.addEventListener("storage", (e) => {
    if (e.key === PLANTS_KEY) {
      plants = load(PLANTS_KEY, []);
      renderPlants();
    }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  applySettings();
  resetForm();
  renderGuide();
  updateNotifyStatus();
  showView(currentView(), { focus: false });
  maybeNotify();
})();
