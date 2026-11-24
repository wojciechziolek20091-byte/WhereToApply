// Clip editor. Layout after openvideodev/react-video-editor: tool rail and
// properties on the left, live preview in the middle, tracks along the bottom.
// The preview plays the untouched source; hook, subtitles and framing are drawn
// over it live, so nothing is rendered until "Save changes".
(() => {
  const root = document.getElementById("editor");
  if (!root) return;
  const id = root.dataset.clip;
  const locked = root.dataset.locked === "true";
  const $ = (s) => document.getElementById(s);
  const fg = $("v-fg"), bg = $("v-bg"), stage = $("stage");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let data = null;      // as loaded from the server
  let st = null;        // current edit state
  let playing = false;

  const fmt = (t) => {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  };
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const snapshot = () => JSON.stringify(st);
  let saved = "";

  // ---------------------------------------------------------------- loading
  async function load() {
    $("ed-error").hidden = true;
    let r;
    try {
      r = await fetch(`/clips/${id}/editor.json`, { credentials: "same-origin" });
    } catch (_) { return fail("Could not reach clipbot. Is it still running?"); }
    if (!r.ok) {
      let msg = "Could not load this clip for editing.";
      try { msg = (await r.json()).detail || msg; } catch (_) {}
      return fail(msg, true);
    }
    data = await r.json();
    st = {
      start: data.clip.start, end: data.clip.end, hook: data.clip.hook,
      hook_seconds: data.edit.hook_seconds, framing: data.edit.framing, crop_x: data.edit.crop_x,
      lines: Object.fromEntries(data.lines.map((l) => [l.key, l.text])),
      caption: { title: data.caption.title, text: data.caption.text, hashtags: data.caption.hashtags.join(" ") },
    };
    saved = snapshot();
    const src = `/clips/${id}/preview.mp4`;
    fg.src = src; bg.src = src;
    $("tl-video").style.backgroundImage = `url("/clips/${id}/filmstrip.jpg")`;
    fg.addEventListener("loadeddata", () => { $("ed-loading").hidden = true; seek(st.start); }, { once: true });
    fillForm(); drawRuler(); drawSubsTrack(); render();
  }
  function fail(msg, retry) {
    const e = $("ed-error");
    e.innerHTML = "";
    e.append(msg + " ");
    if (retry) {
      const b = document.createElement("button");
      b.className = "btn"; b.type = "button"; b.textContent = "Try again";
      b.onclick = load; e.append(b);
    }
    e.hidden = false;
    $("ed-loading").hidden = true;
  }

  // ---------------------------------------------------------------- time
  const srcT = () => data.source.offset + fg.currentTime;      // source time at playhead
  const seek = (t) => { fg.currentTime = clamp(t, data.source.offset, data.source.offset + data.source.duration) - data.source.offset; sync(); };
  const pct = (t) => `${((t - data.source.offset) / data.source.duration) * 100}%`;
  const tAt = (clientX) => {
    const r = $("tl").getBoundingClientRect();
    return data.source.offset + clamp((clientX - r.left) / r.width, 0, 1) * data.source.duration;
  };
  function sync() { if (Math.abs(bg.currentTime - fg.currentTime) > 0.15) bg.currentTime = fg.currentTime; }

  function play() {
    if (srcT() < st.start || srcT() >= st.end - 0.05) seek(st.start);
    fg.play(); if (st.framing === "full") bg.play();
  }
  function pause() { fg.pause(); bg.pause(); }
  fg.addEventListener("play", () => { playing = true; setPlayIcon(); tick(); });
  fg.addEventListener("pause", () => { playing = false; setPlayIcon(); });
  function setPlayIcon() {
    $("b-play").innerHTML = `<i class="ph ph-${playing ? "pause" : "play"}" aria-hidden="true"></i>`;
    $("b-play").setAttribute("aria-label", playing ? "Pause" : "Play clip");
  }
  function tick() {
    if (!data) return;
    if (playing && srcT() >= st.end) {
      if ($("f-loop").checked) seek(st.start); else { pause(); seek(st.end); }
    }
    render();
    if (playing) requestAnimationFrame(tick);
  }
  fg.addEventListener("seeked", render);
  $("b-play").onclick = () => (playing ? pause() : play());

  // ---------------------------------------------------------------- drawing
  function render() {
    if (!data) return;
    const t = srcT();
    $("o-time").textContent = fmt(t - st.start);
    $("o-dur").textContent = fmt(st.end - st.start);
    $("playhead").style.left = pct(t);
    // trim box and shades
    $("trim").style.left = pct(st.start);
    $("trim").style.width = `${((st.end - st.start) / data.source.duration) * 100}%`;
    $("shade-l").style.width = pct(st.start);
    $("shade-r").style.left = pct(st.end);
    const hb = $("blk-hook");
    hb.style.left = pct(st.start);
    hb.style.width = `${(Math.min(st.hook_seconds, st.end - st.start) / data.source.duration) * 100}%`;
    $("o-start").textContent = fmt(st.start);
    $("o-end").textContent = fmt(st.end);
    const len = st.end - st.start;
    $("o-len").textContent = `${len.toFixed(1)} s`;
    $("o-limits").textContent = `(${data.limits.min}-${data.limits.max} s allowed)`;
    // overlays
    const inside = t >= st.start && t < st.end;
    $("ov-out").hidden = inside;
    const showHook = inside && t - st.start < st.hook_seconds;
    $("ov-hook").hidden = !showHook;
    $("ov-hook").textContent = st.hook;
    const line = inside && data.lines.find((l) => l.start <= t && t < l.end && l.end > st.start && l.start < st.end);
    const sub = $("ov-sub");
    if (line) {
      const words = (st.lines[line.key] || "").split(/\s+/).filter(Boolean);
      const i = Math.min(words.length - 1, Math.floor(((t - line.start) / (line.end - line.start)) * words.length));
      sub.innerHTML = "";
      words.forEach((w, k) => {
        const s = document.createElement("span");
        s.textContent = w + " ";
        if (k === i) s.className = "on";
        sub.append(s);
      });
    } else sub.textContent = "";
    // framing
    stage.dataset.framing = st.framing;
    fg.style.objectPosition = `${st.framing === "auto" ? 50 : st.crop_x * 100}% 50%`;
    document.querySelectorAll(".tl-subs .blk").forEach((b) => {
      const l = data.lines.find((x) => x.key === b.dataset.key);
      b.classList.toggle("in", l.end > st.start && l.start < st.end);
      b.classList.toggle("now", l === line);
    });
    const dirty = snapshot() !== saved;
    $("ed-dirty").hidden = !dirty;
    $("ed-save").disabled = !dirty || locked;
    $("ed-reset").disabled = !dirty;
  }

  function drawRuler() {
    const ruler = $("tl-ruler");
    ruler.innerHTML = "";
    const d = data.source.duration;
    const step = d > 120 ? 15 : d > 60 ? 10 : 5;
    const first = Math.ceil(data.source.offset / step) * step;
    for (let t = first; t <= data.source.offset + d; t += step) {
      const m = document.createElement("span");
      m.style.left = pct(t);
      m.textContent = fmt(t).replace(/\.0$/, "");
      ruler.append(m);
    }
  }
  function drawSubsTrack() {
    const tr = $("tl-subs");
    tr.innerHTML = "";
    data.lines.forEach((l) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "blk"; b.dataset.key = l.key;
      b.style.left = pct(l.start);
      b.style.width = `${((l.end - l.start) / data.source.duration) * 100}%`;
      b.title = st.lines[l.key];
      b.onclick = () => { seek(l.start + 0.01); showTool("subs"); focusLine(l.key); };
      tr.append(b);
    });
  }

  // ---------------------------------------------------------------- panels
  function showTool(name) {
    document.querySelectorAll(".ed-rail [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tool === name)));
    document.querySelectorAll(".ed-pane").forEach((p) => { p.hidden = p.id !== { trim: "p-trim", text: "p-text", subs: "p-subs", frame: "p-frame", cap: "p-cap" }[name]; });
    if (name === "subs") fillSubs();
  }
  document.querySelectorAll(".ed-rail [role=tab]").forEach((b) => { b.onclick = () => showTool(b.dataset.tool); });

  function fillForm() {
    $("f-hook").value = st.hook; $("c-hook").textContent = st.hook.length;
    $("f-hook-s").value = st.hook_seconds; $("o-hook-s").textContent = `${st.hook_seconds} s`;
    document.querySelectorAll("input[name=framing]").forEach((r) => { r.checked = r.value === st.framing; });
    $("f-crop").value = Math.round(st.crop_x * 100); $("f-crop").disabled = st.framing !== "crop";
    $("f-cap-title").value = st.caption.title; $("f-cap-text").value = st.caption.text; $("f-cap-tags").value = st.caption.hashtags;
    $("cap-note").textContent = data.language ? `Written in ${data.language}.` : "";
    const missing = data.lines.some((l) => l.missing);
    $("subs-note").textContent = (data.language ? `Shown in ${data.language}. ` : "") + "Change any line; your wording is kept." + (missing ? " Lines marked new are translated when you save." : "");
    fillSubs();
    if (locked) root.querySelectorAll("input, textarea, .ed-panel button, .handle").forEach((e) => { e.disabled = true; });
  }
  function fillSubs() {
    const list = $("sub-list");
    list.innerHTML = "";
    data.lines.filter((l) => l.end > st.start && l.start < st.end).forEach((l) => {
      const li = document.createElement("li");
      const time = document.createElement("button");
      time.type = "button"; time.className = "sub-time mono"; time.textContent = fmt(l.start - st.start);
      time.title = "Play from here"; time.onclick = () => { seek(l.start + 0.01); play(); };
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = st.lines[l.key]; inp.dataset.key = l.key; inp.disabled = locked;
      inp.setAttribute("aria-label", `Subtitle at ${fmt(l.start - st.start)}`);
      inp.oninput = () => { st.lines[l.key] = inp.value; render(); };
      li.append(time, inp);
      if (l.missing) { const n = document.createElement("span"); n.className = "tag"; n.textContent = "new"; li.append(n); }
      if (l.original !== l.text || l.missing) {
        const o = document.createElement("p"); o.className = "muted small sub-orig"; o.textContent = l.original; li.append(o);
      }
      list.append(li);
    });
  }
  function focusLine(key) { const i = document.querySelector(`#sub-list input[data-key="${key}"]`); if (i) i.focus(); }

  $("f-hook").oninput = (e) => { st.hook = e.target.value; $("c-hook").textContent = st.hook.length; render(); };
  $("f-hook-s").oninput = (e) => { st.hook_seconds = +e.target.value; $("o-hook-s").textContent = `${st.hook_seconds} s`; render(); };
  document.querySelectorAll("input[name=framing]").forEach((r) => {
    r.onchange = () => { st.framing = r.value; $("f-crop").disabled = r.value !== "crop"; if (playing) (r.value === "full" ? bg.play() : bg.pause()); render(); };
  });
  $("f-crop").oninput = (e) => { st.crop_x = e.target.value / 100; render(); };
  $("f-cap-title").oninput = (e) => { st.caption.title = e.target.value; render(); };
  $("f-cap-text").oninput = (e) => { st.caption.text = e.target.value; render(); };
  $("f-cap-tags").oninput = (e) => { st.caption.hashtags = e.target.value; render(); };

  // ---------------------------------------------------------------- trimming
  const lo = () => data.source.offset, hi = () => data.source.offset + data.source.duration;
  function setStart(t) { st.start = clamp(t, Math.max(lo(), st.end - data.limits.max), st.end - data.limits.min); }
  function setEnd(t) { st.end = clamp(t, st.start + data.limits.min, Math.min(hi(), st.start + data.limits.max)); }
  document.querySelectorAll("[data-nudge]").forEach((b) => {
    b.onclick = () => {
      const [which, d] = b.dataset.nudge.split(":");
      if (which === "start") setStart(st.start + +d); else setEnd(st.end + +d);
      fillSubs(); render();
    };
  });
  function drag(el, onMove) {
    el.addEventListener("pointerdown", (e) => {
      if (locked) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, s0 = st.start, e0 = st.end;
      const move = (ev) => { onMove(tAt(ev.clientX), ev, startX, s0, e0); render(); };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); fillSubs(); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
  drag($("h-start"), (t) => { setStart(t); seek(st.start); });
  drag($("h-end"), (t) => { setEnd(t); seek(Math.max(st.start, st.end - 1)); });
  drag($("trim"), (t, ev, x0, s0, e0) => {
    const dt = tAt(ev.clientX) - tAt(x0);
    const len = e0 - s0;
    st.start = clamp(s0 + dt, lo(), hi() - len); st.end = st.start + len;
  });
  drag($("h-hook"), (t) => { st.hook_seconds = clamp(Math.round((t - st.start) * 2) / 2, 1, 10); $("f-hook-s").value = st.hook_seconds; $("o-hook-s").textContent = `${st.hook_seconds} s`; });
  // Keyboard on the handles: arrows move a tenth of a second (shift: one second).
  [["h-start", setStart, "start"], ["h-end", setEnd, "end"]].forEach(([hid, set, k]) => {
    $(hid).addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      set(st[k] + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
      fillSubs(); render();
    });
  });
  $("tl").addEventListener("pointerdown", (e) => { if (e.target.closest(".handle, .trim, .blk")) return; seek(tAt(e.clientX)); });

  document.addEventListener("keydown", (e) => {
    if (!data || e.target.closest("input, textarea, select")) return;
    if (e.key === " ") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "[") { setStart(srcT()); fillSubs(); render(); }
    else if (e.key === "]") { setEnd(srcT()); fillSubs(); render(); }
    else if (e.key === "ArrowLeft" && !e.target.closest(".handle")) seek(srcT() - 0.5);
    else if (e.key === "ArrowRight" && !e.target.closest(".handle")) seek(srcT() + 0.5);
  });

  // ---------------------------------------------------------------- saving
  $("ed-reset").onclick = () => { st = JSON.parse(saved); fillForm(); render(); seek(st.start); };
  $("ed-save").onclick = async () => {
    const b = $("ed-save");
    b.disabled = true; b.setAttribute("aria-busy", "true"); b.lastChild.textContent = "Saving…";
    const body = {
      start: +st.start.toFixed(3), end: +st.end.toFixed(3), hook: st.hook, hook_seconds: st.hook_seconds,
      framing: st.framing, crop_x: st.crop_x,
      lines: data.lines.filter((l) => l.end > st.start && l.start < st.end).map((l) => ({ key: l.key, text: st.lines[l.key] })),
      caption: { title: st.caption.title, text: st.caption.text, hashtags: st.caption.hashtags.split(/[\s,]+/).filter(Boolean) },
    };
    try {
      const r = await fetch(`/clips/${id}/edit`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": document.querySelector("meta[name=csrf]").content },
        body: JSON.stringify(body),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok && out.ok) { saved = snapshot(); location.href = out.redirect; return; }
      fail(out.error || out.detail || "Could not save the changes.");
    } catch (_) { fail("Could not reach clipbot. Is it still running?"); }
    b.removeAttribute("aria-busy"); b.lastChild.textContent = "Save changes"; render();
  };
  window.addEventListener("beforeunload", (e) => { if (st && snapshot() !== saved) { e.preventDefault(); e.returnValue = ""; } });

  if (reduce) $("f-loop").checked = false;
  load();
})();
