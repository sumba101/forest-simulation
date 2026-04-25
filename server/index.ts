import { dlopen, ptr } from "bun:ffi";
import { join } from "path";

const W = 1024, H = 768;
const CELL_COUNT = W * H;
const MAX_EVENTS = 4096;

const libExt = process.platform === "darwin" ? "dylib" : "so";
const libPath = join(import.meta.dir, `../sim/zig-out/lib/libsim.${libExt}`);

const { symbols: lib } = dlopen(libPath, {
  sim_create:          { args: ["u32", "u32", "u64"], returns: "ptr" },
  sim_tick:            { args: ["ptr"], returns: "void" },
  sim_get_cells:       { args: ["ptr", "ptr"], returns: "void" },
  sim_get_fire_events: { args: ["ptr", "ptr"], returns: "u32" },
  sim_set_param:       { args: ["ptr", "u32", "f64"], returns: "void" },
  sim_reset:           { args: ["ptr", "u64"], returns: "void" },
  sim_ignite:          { args: ["ptr", "u32", "u32"], returns: "void" },
  sim_get_tick:        { args: ["ptr"], returns: "u64" },
  sim_destroy:         { args: ["ptr"], returns: "void" },
});

const encoder = new TextEncoder();

let stepsPerFrame = 1;
let paused = false;
let simHandle = lib.sim_create(W, H, BigInt(Date.now()))!;

// Pinned buffers — must stay alive for FFI
const cellsBuf = new Uint8Array(CELL_COUNT);
const eventsBuf = new Uint32Array(MAX_EVENTS);

const clients = new Set<any>();

function setParam(name: string, value: number) {
  const nameBuf = encoder.encode(name);
  lib.sim_set_param(ptr(nameBuf), nameBuf.length, value);
}

function buildStateMessage(): Buffer {
  lib.sim_get_cells(simHandle, ptr(cellsBuf));
  const evtCount = Number(lib.sim_get_fire_events(simHandle, ptr(eventsBuf)));
  const tick = BigInt(lib.sim_get_tick(simHandle));

  // Layout: [u8 type][u32 cellCount][cells][u32 evtCount][events...][u64 tick]
  const msgSize = 1 + 4 + CELL_COUNT + 4 + evtCount * 4 + 8;
  const msg = new ArrayBuffer(msgSize);
  const view = new DataView(msg);
  let off = 0;
  view.setUint8(off, 0); off += 1;
  view.setUint32(off, CELL_COUNT, true); off += 4;
  new Uint8Array(msg, off, CELL_COUNT).set(cellsBuf); off += CELL_COUNT;
  view.setUint32(off, evtCount, true); off += 4;
  for (let i = 0; i < evtCount; i++) {
    view.setUint32(off, eventsBuf[i], true); off += 4;
  }
  view.setBigUint64(off, tick, true);
  return Buffer.from(msg);
}

// 30 fps broadcast interval (was 100ms / 10fps).
setInterval(() => {
  if (paused || clients.size === 0) return;
  for (let i = 0; i < stepsPerFrame; i++) lib.sim_tick(simHandle);
  const frame = buildStateMessage();
  for (const ws of clients) ws.send(frame);
}, 33);

const publicDir = join(import.meta.dir, "public");

const server = Bun.serve({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws" && server.upgrade(req)) return undefined;

    const safePath = url.pathname.replace(/\.\./g, "").replace(/^\/+/, "");
    const filePath = join(publicDir, safePath || "index.html");
    if (!filePath.startsWith(publicDir)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not Found", { status: 404 });
    return new Response(file);
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(buildStateMessage());
    },
    close(ws) {
      clients.delete(ws);
    },
    message(_ws, data) {
      if (typeof data !== "string") return;
      try {
        const msg = JSON.parse(data);
        switch (msg.type) {
          case "set_param":
            setParam(String(msg.name), Number(msg.value));
            break;
          case "stepsPerFrame":
            stepsPerFrame = Math.max(1, Math.min(2000, Number(msg.value)));
            break;
          case "pause":
            paused = true;
            break;
          case "resume":
            paused = false;
            break;
          case "reset":
            lib.sim_reset(simHandle, BigInt(msg.seed ?? Date.now()));
            break;
          case "ignite": {
            const x = Math.max(0, Math.min(W - 1, Number(msg.x) | 0));
            const y = Math.max(0, Math.min(H - 1, Number(msg.y) | 0));
            const r = Math.max(0, Math.min(20, (Number(msg.r) | 0) || 0));
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                if (dx*dx + dy*dy <= r*r) lib.sim_ignite(simHandle, x + dx, y + dy);
              }
            }
            break;
          }
        }
      } catch { /* ignore parse errors */ }
    },
  },
});

console.log(`Forest simulation → http://localhost:${server.port}`);
console.log(`Grid: ${W}×${H}  |  Lib: ${libPath}`);
