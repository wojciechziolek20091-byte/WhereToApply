// Small progressive enhancements; every page works without them.
document.querySelectorAll("form[data-confirm]").forEach((f) => {
  f.addEventListener("submit", (e) => {
    if (!confirm(f.dataset.confirm)) e.preventDefault();
  });
});

// Keep the home page fresh: reload when the bot's state changes.
const status = document.querySelector("[data-poll]");
if (status) {
  let last = null;
  const check = async () => {
    try {
      const r = await fetch(status.dataset.poll, { credentials: "same-origin" });
      if (!r.ok) return;
      const s = await r.json();
      const key = JSON.stringify([s.running, s.paused, s.clips, s.videos]);
      const typing = document.activeElement && document.activeElement.tagName === "INPUT";
      if (last !== null && key !== last && !typing) location.reload();
      last = key;
    } catch (_) { /* offline for a moment */ }
  };
  check();
  setInterval(check, 10000);
}
