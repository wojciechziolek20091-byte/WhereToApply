// Progressive enhancement only: every page works without this file.

// Confirm before destructive or disruptive actions.
document.querySelectorAll("form[data-confirm]").forEach((f) => {
  f.addEventListener("submit", (e) => {
    if (!confirm(f.dataset.confirm)) e.preventDefault();
  });
});

// Show that a submitted action is running, and prevent double submits.
document.querySelectorAll("form").forEach((f) => {
  f.addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    const b = f.querySelector("button[data-busy]");
    if (!b) return;
    b.setAttribute("aria-busy", "true");
    b.textContent = b.dataset.busy;
    setTimeout(() => { b.disabled = true; }, 0);
  });
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
      const key = JSON.stringify([s.running, s.paused, s.clips, s.videos]);
      const busy = document.activeElement && ["INPUT", "SELECT"].includes(document.activeElement.tagName);
      if (last !== null && key !== last && !busy) location.reload();
      last = key;
    } catch (_) { /* briefly offline */ }
  };
  check();
  setInterval(check, 10000);
}
