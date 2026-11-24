// Progressive enhancement only: every page works without this file.

// Confirm before destructive or disruptive actions, then show that the action is
// running and prevent double submits. Delegated, so forms added later (the
// "Clipping Now" panel refreshes itself) behave the same.
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (!(f instanceof HTMLFormElement)) return;
  if (f.dataset.confirm && !confirm(f.dataset.confirm)) { e.preventDefault(); return; }
  const b = f.querySelector("button[data-busy]");
  if (!b) return;
  b.setAttribute("aria-busy", "true");
  b.textContent = b.dataset.busy;
  setTimeout(() => { b.disabled = true; }, 0);
});
document.querySelectorAll("a[data-busy-link]").forEach((a) => {
  a.addEventListener("click", () => { a.setAttribute("aria-busy", "true"); a.textContent = a.dataset.busyLink; });
});

// Warn before leaving the settings page with unsaved changes.
document.querySelectorAll("form[data-dirty-guard]").forEach((f) => {
  let dirty = false;
  f.addEventListener("input", () => { dirty = true; });
  f.addEventListener("submit", () => { dirty = false; });
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
});

// Dates and times in the viewer's own locale.
const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
const wkTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const relative = (d) => {
  const s = (d - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 90) return rel.format(Math.round(s), "second");
  if (a < 5400) return rel.format(Math.round(s / 60), "minute");
  if (a < 172800) return rel.format(Math.round(s / 3600), "hour");
  return rel.format(Math.round(s / 86400), "day");
};
const formatTimes = () => {
  document.querySelectorAll("time[data-fmt]").forEach((t) => {
    const d = new Date(t.getAttribute("datetime"));
    if (isNaN(d)) return;
    t.textContent = t.dataset.fmt === "relative" ? relative(d) : wkTime.format(d);
    t.title = d.toLocaleString();
  });
};
formatTimes();
setInterval(formatTimes, 30000);

// Keep the overview fresh: reload when the bot's state changes.
const status = document.querySelector("[data-poll]");
if (status) {
  let last = null;
  const check = async () => {
    try {
      const r = await fetch(status.dataset.poll, { credentials: "same-origin" });
      if (!r.ok) return;
      const s = await r.json();
      // Video stages are shown live in "Clipping Now"; reload only for what the
      // rest of the page shows: bot state and finished clips.
      const c = s.clips || {};
      const key = JSON.stringify([s.running, s.paused, c.qa_passed, c.scheduled, c.awaiting_approval, c.published]);
      const busy = document.activeElement && ["INPUT", "SELECT"].includes(document.activeElement.tagName);
      if (last !== null && key !== last && !busy) location.reload();
      last = key;
    } catch (_) { /* briefly offline */ }
  };
  check();
  setInterval(check, 10000);
}

// "Clipping Now": refresh the stage of each video every few seconds.
const jobs = document.querySelector("[data-progress]");
if (jobs) {
  const panel = jobs.closest("section");
  let last = jobs.innerHTML.trim();
  const refresh = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(jobs.dataset.progress, { credentials: "same-origin" });
      if (!r.ok) return;
      const html = (await r.text()).trim();
      if (html !== last) {
        last = html;
        jobs.innerHTML = html;
        markShowcases();
        formatTimes();
      }
      panel.hidden = html === "";
    } catch (_) { /* briefly offline */ }
  };
  setInterval(refresh, 3000);
}

// A showcase animates in once per finished round; after that it just shows.
function markShowcases() {
  document.querySelectorAll(".showcase[data-key]").forEach((el) => {
    const key = "showcase:" + el.dataset.key;
    let seen = false;
    try { seen = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch (_) {}
    if (seen) el.classList.add("seen");
  });
}
markShowcases();

// Hover (or keyboard focus) on a clip thumbnail plays it, muted.
const startPreview = (reel) => {
  const frame = reel.querySelector(".reel-frame");
  if (!frame || !reel.dataset.preview) return;
  let v = frame.querySelector("video");
  if (!v) {
    v = document.createElement("video");
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "metadata" });
    v.src = reel.dataset.preview;
    frame.appendChild(v);
  }
  v.play().then(() => v.classList.add("playing")).catch(() => {});
};
const stopPreview = (reel) => {
  const v = reel.querySelector(".reel-frame video");
  if (v) { v.pause(); v.classList.remove("playing"); }
};
if (window.matchMedia("(hover: hover)").matches) {
  document.addEventListener("mouseover", (e) => {
    const r = e.target.closest && e.target.closest(".reel");
    if (r && !r.contains(e.relatedTarget)) startPreview(r);
  });
  document.addEventListener("mouseout", (e) => {
    const r = e.target.closest && e.target.closest(".reel");
    if (r && !r.contains(e.relatedTarget)) stopPreview(r);
  });
}
document.addEventListener("focusin", (e) => { const r = e.target.closest && e.target.closest(".reel"); if (r) startPreview(r); });
document.addEventListener("focusout", (e) => { const r = e.target.closest && e.target.closest(".reel"); if (r) stopPreview(r); });
