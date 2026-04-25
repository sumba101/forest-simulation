const W = 1024, H = 768;
const CELL_COUNT = W * H;

// 0=empty, 1=tree, 2=burning, 3=ash
const COLORS = [
  [28,  22,  13,  255],
  [63,  156, 44,  255],
  [255, 90,  32,  255],
  [43,  40,  37,  255],
];
const LABELS = ["empty", "tree", "burning", "ash"];
const BURNING_INDEX = 2;

// Pack RGBA into native-endian u32 once so renderCells can do one write per cell.
const COLORS_U32 = new Uint32Array(COLORS.length);
(() => {
  const probe = new Uint8Array(4);
  new Uint32Array(probe.buffer)[0] = 0x01020304;
  const littleEndian = probe[0] === 0x04;
  for (let k = 0; k < COLORS.length; k++) {
    const [r, g, b, a] = COLORS[k];
    COLORS_U32[k] = littleEndian
      ? (a << 24) | (b << 16) | (g << 8) | r
      : (r << 24) | (g << 16) | (b << 8) | a;
  }
})();

const $ = (id) => document.getElementById(id);

const simCanvas    = $("sim-canvas");
const simCtx       = simCanvas.getContext("2d");
const brushCursor  = $("brush-cursor");
const simWrap      = simCanvas.parentElement;
const loglogCanvas = $("chart-loglog");
const loglogCtx    = loglogCanvas.getContext("2d");
const timeCanvas   = $("chart-time");
const timeCtx      = timeCanvas.getContext("2d");

const imgData = simCtx.createImageData(W, H);
const imgPixels = new Uint32Array(imgData.data.buffer);

let fireEvents = [];
let activityHistory = [];
const ACTIVITY_LEN = 600;
let running = true;
let brushRadius = 0;
let lastTick = 0;
let lastWallClock = 0;
let fpsEMA = 10;

// ── HiDPI canvas setup ───────────────────────────────────────────────
function setupHiDPI(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function logicalSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

// ── WebSocket ──────────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.binaryType = "arraybuffer";

ws.onopen  = () => { $("sim-conn").innerHTML = '<span style="color:var(--good)">●</span> live'; };
ws.onclose = () => { $("sim-conn").innerHTML = '<span style="color:var(--danger)">●</span> disconnected'; };
ws.onerror = () => { $("sim-conn").innerHTML = '<span style="color:var(--danger)">●</span> error'; };

ws.onmessage = (event) => {
  const buf = event.data;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 0) return;

  let off = 1;
  const cellCount = view.getUint32(off, true); off += 4;
  const cells = new Uint8Array(buf, off, cellCount); off += cellCount;
  const evtCount = view.getUint32(off, true); off += 4;
  fireEvents = new Array(evtCount);
  for (let i = 0; i < evtCount; i++) {
    fireEvents[i] = view.getUint32(off, true); off += 4;
  }
  const tick = Number(view.getBigUint64(off, true)); off += 8;

  renderCells(cells);
  updateStats(cells, tick, evtCount);
  pushActivity(cells, tick);
  drawLogLog();
  drawActivity();
};

// ── Simulation rendering ──────────────────────────────────────────────
function renderCells(cells) {
  for (let i = 0; i < CELL_COUNT; i++) imgPixels[i] = COLORS_U32[cells[i]];
  simCtx.putImageData(imgData, 0, 0);
}

// ── Stats bar ──────────────────────────────────────────────────────────
function updateStats(cells, tick, totalFires) {
  const counts = [0,0,0,0];
  for (let i = 0; i < cells.length; i++) counts[cells[i]]++;
  const total = cells.length;

  $("s-tick").textContent  = tick.toLocaleString();
  $("s-fires").textContent = totalFires.toLocaleString();

  for (let k = 0; k < 4; k++) {
    const v = counts[k];
    const pct = total > 0 ? (v / total * 100) : 0;
    const valEl = $(`s-${LABELS[k]}`);
    const pctEl = $(`s-${LABELS[k]}-pct`);
    if (valEl) valEl.textContent = v.toLocaleString();
    if (pctEl) pctEl.textContent = ` (${pct.toFixed(1)}%)`;
  }

  // FPS estimate (frames per second of sim updates received)
  const now = performance.now();
  if (lastWallClock > 0) {
    const dt = (now - lastWallClock) / 1000;
    if (dt > 0) {
      const inst = 1 / dt;
      fpsEMA = fpsEMA * 0.85 + inst * 0.15;
    }
  }
  lastWallClock = now;
  const speed = tick - lastTick;
  lastTick = tick;
  $("sim-fps").textContent = `${fpsEMA.toFixed(1)} fps · ${speed} ticks/frame`;
}

// ── Activity history (burning cells per frame) ────────────────────────
function pushActivity(cells, tick) {
  let burning = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === BURNING_INDEX) burning++;
  activityHistory.push({ tick, burning });
  if (activityHistory.length > ACTIVITY_LEN) activityHistory.shift();
}

// ── Log-Log chart ──────────────────────────────────────────────────────
function drawLogLog() {
  setupHiDPI(loglogCanvas, loglogCtx);
  const { w: cw, h: ch } = logicalSize(loglogCanvas);
  const ctx = loglogCtx;

  const ml = 58, mr = 16, mt = 16, mb = 38;
  const pw = cw - ml - mr, ph = ch - mt - mb;

  ctx.fillStyle = "#11161e";
  ctx.fillRect(0, 0, cw, ch);

  const n = fireEvents.length;
  if (n === 0) {
    ctx.fillStyle = "#5c6573";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No fire events yet — let it run", ml + pw/2, mt + ph/2);
    return;
  }

  const NUM_BINS = 21;
  const bins = Array.from({ length: NUM_BINS }, (_, k) => ({
    lo: 1 << k, hi: 1 << (k + 1), count: 0,
  }));
  for (const s of fireEvents) {
    if (s <= 0) continue;
    const k = Math.min(Math.floor(Math.log2(s)), NUM_BINS - 1);
    bins[k].count++;
  }
  const active = bins.filter(b => b.count > 0);
  if (active.length === 0) return;

  const X_MIN = 1, X_MAX = W * H;
  const xMinL = Math.log10(X_MIN), xMaxL = Math.log10(X_MAX);
  const maxNorm = active.reduce((m, b) => Math.max(m, b.count / n), 0);
  const yMaxL = Math.ceil(Math.log10(maxNorm) + 0.5);
  const yMinL = Math.log10(0.4 / n);

  const toX = v => ml + (Math.log10(Math.max(v, X_MIN)) - xMinL) / (xMaxL - xMinL) * pw;
  const toY = v => mt + ph - (Math.log10(Math.max(v, Math.pow(10, yMinL))) - yMinL) / (yMaxL - yMinL) * ph;

  ctx.strokeStyle = "#1d2230";
  ctx.lineWidth = 1;
  for (let e = 0; e <= Math.ceil(xMaxL); e++) {
    const cx = toX(Math.pow(10, e));
    if (cx < ml || cx > ml + pw) continue;
    ctx.beginPath(); ctx.moveTo(cx, mt); ctx.lineTo(cx, mt + ph); ctx.stroke();
  }
  for (let e = Math.ceil(yMinL); e <= yMaxL; e++) {
    const cy = toY(Math.pow(10, e));
    if (cy < mt || cy > mt + ph) continue;
    ctx.beginPath(); ctx.moveTo(ml, cy); ctx.lineTo(ml + pw, cy); ctx.stroke();
  }

  ctx.strokeStyle = "#2e3744";
  ctx.strokeRect(ml, mt, pw, ph);

  // X tick labels
  ctx.fillStyle = "#8b95a4";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (const [v, lbl] of [[1,"1"],[10,"10"],[100,"100"],[1000,"1K"],[10000,"10K"],[100000,"100K"],[1000000,"1M"]]) {
    const cx = toX(v);
    if (cx < ml || cx > ml + pw) continue;
    ctx.fillText(lbl, cx, mt + ph + 14);
  }
  ctx.fillStyle = "#5c6573";
  ctx.font = "10.5px sans-serif";
  ctx.fillText("fire size", ml + pw/2, ch - 8);

  // Y tick labels
  ctx.textAlign = "right";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = "#8b95a4";
  for (let e = Math.ceil(yMinL); e <= yMaxL; e++) {
    const v = Math.pow(10, e);
    const cy = toY(v);
    if (cy < mt || cy > mt + ph) continue;
    const lbl = v >= 1 ? v.toString() : v.toFixed(Math.max(0, -e));
    ctx.fillText(lbl, ml - 6, cy + 3.5);
  }

  ctx.save();
  ctx.translate(14, mt + ph/2); ctx.rotate(-Math.PI/2);
  ctx.fillStyle = "#5c6573"; ctx.font = "10.5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("normalized count", 0, 0);
  ctx.restore();

  // Reference power-law slopes, anchored to the largest-count bin.
  // τ = 1.15 is the canonical 2D Drossel–Schwabl effective exponent
  // (Grassberger '93/'02; Clar/Drossel/Schwabl '96).
  // τ = 1.00 is the boundary "1/s" slope — flat on log-binned plots —
  // which the simulation approaches when finite-size effects dominate.
  const anchor = active.reduce((a, b) => b.count > a.count ? b : a);
  const aMid = Math.sqrt(anchor.lo * anchor.hi);
  const aNorm = anchor.count / n;

  function drawSlope(tau, color) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let firstSeg = true;
    for (let x = X_MIN; x <= X_MAX; x *= 1.5) {
      const cx = toX(x);
      const cy = toY(aNorm * Math.pow(x / aMid, -tau));
      if (firstSeg) { ctx.moveTo(cx, cy); firstSeg = false; } else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawSlope(1.00, "rgba(139, 148, 158, 0.30)");
  drawSlope(1.15, "rgba(139, 148, 158, 0.60)");

  // data line
  ctx.strokeStyle = "rgba(240, 136, 62, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  first = true;
  for (const bin of active) {
    const mid = Math.sqrt(bin.lo * bin.hi);
    const cx = toX(mid), cy = toY(bin.count / n);
    if (first) { ctx.moveTo(cx, cy); first = false; } else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // dots
  ctx.fillStyle = "#f0883e";
  for (const bin of active) {
    const mid = Math.sqrt(bin.lo * bin.hi);
    ctx.beginPath();
    ctx.arc(toX(mid), toY(bin.count / n), 3.5, 0, Math.PI*2);
    ctx.fill();
  }

  // legend
  const lx = ml + pw - 140, ly = mt + 8;
  ctx.fillStyle = "#f0883e";
  ctx.fillRect(lx, ly, 11, 11);
  ctx.fillStyle = "#e6edf3"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("data", lx + 16, ly + 9);

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(139, 148, 158, 0.6)";
  ctx.beginPath(); ctx.moveTo(lx, ly + 22); ctx.lineTo(lx + 11, ly + 22); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#8b95a4";
  ctx.fillText("τ = 1.15  (DS canonical)", lx + 16, ly + 25);

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(139, 148, 158, 0.30)";
  ctx.beginPath(); ctx.moveTo(lx, ly + 38); ctx.lineTo(lx + 11, ly + 38); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#8b95a4";
  ctx.fillText("τ = 1.00  (1/s boundary)", lx + 16, ly + 41);

  ctx.fillStyle = "#5c6573"; ctx.font = "10.5px ui-monospace, monospace";
  ctx.fillText(`n = ${n}`, ml + 6, mt + 12);

  $("loglog-sub").textContent = `log–log binned · ${n} fires (ring buffer cap 4096)`;
}

// ── Activity (time-series) chart ──────────────────────────────────────
function drawActivity() {
  setupHiDPI(timeCanvas, timeCtx);
  const { w: cw, h: ch } = logicalSize(timeCanvas);
  const ctx = timeCtx;

  const ml = 50, mr = 14, mt = 14, mb = 32;
  const pw = cw - ml - mr, ph = ch - mt - mb;

  ctx.fillStyle = "#11161e";
  ctx.fillRect(0, 0, cw, ch);

  if (activityHistory.length === 0) {
    ctx.fillStyle = "#5c6573";
    ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Waiting…", ml + pw/2, mt + ph/2);
    return;
  }

  const maxBurn = Math.max(8, ...activityHistory.map(a => a.burning));
  const ymax = Math.pow(2, Math.ceil(Math.log2(maxBurn)));

  ctx.strokeStyle = "#2e3744";
  ctx.strokeRect(ml, mt, pw, ph);

  // grid lines
  ctx.strokeStyle = "#1d2230";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const cy = mt + ph * (i/4);
    ctx.beginPath(); ctx.moveTo(ml, cy); ctx.lineTo(ml + pw, cy); ctx.stroke();
  }

  // y-axis labels
  ctx.fillStyle = "#8b95a4";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = ymax * (1 - i/4);
    const cy = mt + ph * (i/4) + 3.5;
    ctx.fillText(v.toString(), ml - 6, cy);
  }
  ctx.save();
  ctx.translate(13, mt + ph/2); ctx.rotate(-Math.PI/2);
  ctx.fillStyle = "#5c6573"; ctx.font = "10.5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("burning cells", 0, 0);
  ctx.restore();

  // x-axis: tick window
  const firstTick = activityHistory[0].tick;
  const lastTickV = activityHistory[activityHistory.length - 1].tick;
  ctx.fillStyle = "#8b95a4"; ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`t=${firstTick}`, ml + 2, mt + ph + 14);
  ctx.textAlign = "right";
  ctx.fillText(`t=${lastTickV}`, ml + pw - 2, mt + ph + 14);

  // area under curve (filled)
  ctx.fillStyle = "rgba(255, 90, 32, 0.18)";
  ctx.beginPath();
  ctx.moveTo(ml, mt + ph);
  const N = activityHistory.length;
  for (let i = 0; i < N; i++) {
    const a = activityHistory[i];
    const cx = ml + (i / Math.max(1, ACTIVITY_LEN - 1)) * pw;
    const cy = mt + ph - (a.burning / ymax) * ph;
    ctx.lineTo(cx, cy);
  }
  const lastX = ml + ((N - 1) / Math.max(1, ACTIVITY_LEN - 1)) * pw;
  ctx.lineTo(lastX, mt + ph);
  ctx.closePath();
  ctx.fill();

  // line
  ctx.strokeStyle = "#ff5a20";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = activityHistory[i];
    const cx = ml + (i / Math.max(1, ACTIVITY_LEN - 1)) * pw;
    const cy = mt + ph - (a.burning / ymax) * ph;
    if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // current value label
  const cur = activityHistory[N - 1].burning;
  ctx.fillStyle = "#ff5a20";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`now: ${cur}`, ml + pw - 4, mt + 14);
}

// ── Controls ──────────────────────────────────────────────────────────
function send(msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function fmtSci(v) {
  if (v === 0) return "0";
  return v.toExponential(2)
    .replace("e+0", "e").replace("e-0", "e-").replace("e+", "e");
}
function fmtFixed(v) { return v.toFixed(2); }

// Log-scale slider: stores log10 in slider, sends linear value.
function wireLogSlider(id, label, paramName) {
  const sl = $(id), lb = $(label);
  const update = () => {
    const v = Math.pow(10, parseFloat(sl.value));
    lb.textContent = fmtSci(v);
    send({ type: "set_param", name: paramName, value: v });
  };
  sl.addEventListener("input", update);
  // initial label
  lb.textContent = fmtSci(Math.pow(10, parseFloat(sl.value)));
}
function wireLinearSlider(id, label, paramName, fmt) {
  const sl = $(id), lb = $(label);
  const update = () => {
    const v = parseFloat(sl.value);
    lb.textContent = fmt(v);
    send({ type: "set_param", name: paramName, value: v });
  };
  sl.addEventListener("input", update);
  lb.textContent = fmt(parseFloat(sl.value));
}

wireLogSlider("sl-tree-growth", "lbl-tree-growth", "tree_growth");
wireLogSlider("sl-lightning",   "lbl-lightning",   "lightning_chance");
wireLinearSlider("sl-ignition", "lbl-ignition",    "ignition_chance", fmtFixed);

const slPauseFire = $("sl-pause-fire"), lblPauseFire = $("lbl-pause-fire");
slPauseFire.addEventListener("input", () => {
  const on = parseInt(slPauseFire.value) === 1;
  lblPauseFire.textContent = on ? "On" : "Off";
  send({ type: "set_param", name: "pause_on_fire", value: on ? 1 : 0 });
});

const slSteps = $("sl-steps"), lblSteps = $("lbl-steps");
slSteps.addEventListener("input", () => {
  lblSteps.textContent = slSteps.value;
  send({ type: "stepsPerFrame", value: parseInt(slSteps.value) });
});

const slBrush = $("sl-brush"), lblBrush = $("lbl-brush");
slBrush.addEventListener("input", () => {
  brushRadius = parseInt(slBrush.value);
  lblBrush.textContent = brushRadius;
  updateBrushVisual();
});

const btnToggle = $("btn-toggle"), runBadge = $("run-state");
btnToggle.addEventListener("click", () => {
  running = !running;
  btnToggle.textContent = running ? "Pause" : "Resume";
  btnToggle.classList.toggle("primary", running);
  btnToggle.classList.toggle("danger", !running);
  runBadge.textContent = running ? "Running" : "Paused";
  send({ type: running ? "resume" : "pause" });
});

$("btn-reset").addEventListener("click", () => {
  const seed = parseInt($("inp-seed").value) || Date.now();
  fireEvents = [];
  activityHistory = [];
  send({ type: "reset", seed });
});

$("btn-strike").addEventListener("click", strikeRandomLightning);

function strikeRandomLightning() {
  send({
    type: "ignite",
    x: Math.floor(Math.random() * W),
    y: Math.floor(Math.random() * H),
    r: 0,
  });
}

// ── Click & drag to ignite ────────────────────────────────────────────
let dragging = false;

function canvasToGrid(ev) {
  const rect = simCanvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - rect.left) / rect.width)  * W);
  const y = Math.floor(((ev.clientY - rect.top)  / rect.height) * H);
  return { x, y };
}

function igniteAt(ev) {
  const { x, y } = canvasToGrid(ev);
  send({ type: "ignite", x, y, r: brushRadius });
}

simCanvas.addEventListener("pointerdown", (ev) => {
  dragging = true;
  simCanvas.setPointerCapture(ev.pointerId);
  igniteAt(ev);
});
simCanvas.addEventListener("pointermove", (ev) => {
  positionBrush(ev);
  if (dragging) igniteAt(ev);
});
simCanvas.addEventListener("pointerup",   (ev) => { dragging = false; });
simCanvas.addEventListener("pointerleave",() => { brushCursor.style.opacity = 0; });
simCanvas.addEventListener("pointerenter",() => { updateBrushVisual(); });

function positionBrush(ev) {
  const rect = simWrap.getBoundingClientRect();
  brushCursor.style.left = (ev.clientX - rect.left) + "px";
  brushCursor.style.top  = (ev.clientY - rect.top)  + "px";
  updateBrushVisual();
}
function updateBrushVisual() {
  const rect = simCanvas.getBoundingClientRect();
  const cellPx = rect.width / W;
  const diameter = Math.max(8, (brushRadius * 2 + 1) * cellPx);
  brushCursor.style.width  = diameter + "px";
  brushCursor.style.height = diameter + "px";
  brushCursor.style.opacity = 1;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;
  if (ev.code === "Space") { ev.preventDefault(); btnToggle.click(); }
  else if (ev.code === "KeyR") { ev.preventDefault(); $("btn-reset").click(); }
  else if (ev.code === "KeyL") { ev.preventDefault(); strikeRandomLightning(); }
});

window.addEventListener("resize", () => {
  drawLogLog();
  drawActivity();
});
