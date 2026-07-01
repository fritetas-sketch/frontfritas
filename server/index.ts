/**
 * FrontFritas authoritative multiplayer server.
 *
 * The server owns the simulation: clients send attack commands, the server
 * ticks the `Game` and broadcasts compact owner deltas + player stats. Terrain
 * is regenerated on each client from the shared seed, so only ownership and
 * stats travel over the wire.
 *
 * Run with:  npm run server   (Node 22+, uses --experimental-strip-types)
 * Serves the built client from ../dist if present, and WebSocket on the same
 * port so a streamer can host everything from one URL.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

import { Game } from "../src/game.ts";
import { fillBots } from "../src/palette.ts";
import { SIZES } from "../src/protocol.ts";
import type { C2S, RoomConfig, S2C } from "../src/protocol.ts";
import { NEUTRAL, type PlayerDesc } from "../src/types.ts";

const PORT = Number(process.env.PORT) || 8787;
const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const MAX_PLAYERS = 48;
const TICK_MS = 100;

interface Member {
  ws: WebSocket;
  name: string;
  color: [number, number, number];
  id: number; // game player id once started, -1 = lobby/spectator
  spectator: boolean;
}

interface Room {
  code: string;
  config: RoomConfig;
  members: Member[];
  game: Game | null;
  seed: number;
  lastOwner: Int16Array | null;
  timer: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, Room>();

// ----------------------------------------------------------------- utilities
function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function send(ws: WebSocket, msg: S2C) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: S2C) {
  const data = JSON.stringify(msg);
  for (const m of room.members) if (m.ws.readyState === m.ws.OPEN) m.ws.send(data);
}

function sanitizeName(n: unknown): string {
  return (typeof n === "string" ? n : "").trim().slice(0, 14) || "Joueur";
}
function sanitizeColor(c: unknown): [number, number, number] {
  if (Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number")) {
    return [c[0] & 255, c[1] & 255, c[2] & 255];
  }
  return [200, 200, 200];
}

// --------------------------------------------------------------- lobby / room
function lobbyMsg(room: Room, host: boolean): Extract<S2C, { t: "lobby" }> {
  return {
    t: "lobby",
    code: room.code,
    host,
    config: room.config,
    members: room.members
      .filter((m) => !m.spectator)
      .map((m, i) => ({ name: m.name, color: m.color, host: i === 0 })),
  };
}

function sendLobby(room: Room) {
  const humans = room.members.filter((m) => !m.spectator);
  for (const m of room.members) {
    if (m.spectator) continue;
    send(m.ws, lobbyMsg(room, m === humans[0]));
  }
}

function startGame(room: Room) {
  const humans = room.members.filter((m) => !m.spectator);
  const size = SIZES[room.config.size] ?? SIZES.medium;
  let bots = Math.max(0, Math.min(40, room.config.bots | 0));
  if (humans.length + bots > MAX_PLAYERS) bots = MAX_PLAYERS - humans.length;

  const humanDescs: PlayerDesc[] = humans.map((m) => ({
    name: m.name,
    color: m.color,
    isBot: false,
  }));
  const roster = fillBots(humanDescs, bots);
  const seed = (Date.now() ^ (Math.floor(Math.random() * 0xffffffff))) >>> 0;

  const game = new Game({ width: size[0], height: size[1], seed, roster });
  room.game = game;
  room.seed = seed;
  room.lastOwner = new Int16Array(game.owner.length).fill(NEUTRAL);

  humans.forEach((m, i) => (m.id = i));

  const rosterMsg = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    isBot: p.isBot,
  }));

  for (const m of room.members) {
    send(m.ws, {
      t: "start",
      code: room.code,
      seed,
      width: size[0],
      height: size[1],
      roster: rosterMsg,
      you: m.spectator ? -1 : m.id,
    });
  }

  room.timer = setInterval(() => tickRoom(room), TICK_MS);
}

function tickRoom(room: Room) {
  const game = room.game;
  if (!game || !room.lastOwner) return;

  game.tick(TICK_MS / 1000);

  // Build owner delta vs last broadcast.
  const owner = game.owner;
  const last = room.lastOwner;
  const deltas: number[] = [];
  const threshold = owner.length * 0.4;
  let full: string | undefined;

  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== last[i]) {
      deltas.push(i, owner[i]);
      last[i] = owner[i];
      if (deltas.length > threshold * 2) break; // will send full snapshot
    }
  }
  if (deltas.length > threshold * 2) {
    last.set(owner);
    full = Buffer.from(owner.buffer, owner.byteOffset, owner.byteLength).toString("base64");
  }

  const stats = game.players.map(
    (p) => [Math.round(p.troops), p.tiles, p.alive ? 1 : 0] as [number, number, number],
  );

  const msg: Extract<S2C, { t: "state" }> = { t: "state", stats };
  if (full) msg.full = full;
  else if (deltas.length) msg.d = deltas;

  if (game.gameOver) {
    const w = game.players[game.winnerId];
    msg.over = { winner: game.winnerId, name: w ? w.name : "—" };
  }

  broadcast(room, msg);

  if (game.gameOver && room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function fullSnapshot(game: Game): string {
  const o = game.owner;
  return Buffer.from(o.buffer, o.byteOffset, o.byteLength).toString("base64");
}

// ------------------------------------------------------------- message router
function handle(member: Member, room: { current: Room | null }, raw: string) {
  let msg: C2S;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.t) {
    case "create": {
      if (room.current) return;
      const r: Room = {
        code: makeCode(),
        config: {
          size: typeof msg.config?.size === "string" ? msg.config.size : "medium",
          bots: Math.max(0, Math.min(40, (msg.config?.bots | 0) || 0)),
        },
        members: [member],
        game: null,
        seed: 0,
        lastOwner: null,
        timer: null,
      };
      member.name = sanitizeName(msg.name);
      member.color = sanitizeColor(msg.color);
      rooms.set(r.code, r);
      room.current = r;
      sendLobby(r);
      break;
    }

    case "join": {
      if (room.current) return;
      const r = rooms.get(String(msg.code || "").toUpperCase());
      if (!r) {
        send(member.ws, { t: "error", msg: "Salon introuvable." });
        return;
      }
      member.name = sanitizeName(msg.name);
      member.color = sanitizeColor(msg.color);

      if (r.game) {
        // Game already running → join as spectator and sync immediately.
        member.spectator = true;
        member.id = -1;
        r.members.push(member);
        room.current = r;
        const size = SIZES[r.config.size] ?? SIZES.medium;
        send(member.ws, {
          t: "start",
          code: r.code,
          seed: r.seed,
          width: size[0],
          height: size[1],
          roster: r.game.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot })),
          you: -1,
        });
        send(member.ws, { t: "state", stats: statsOf(r.game), full: fullSnapshot(r.game) });
        break;
      }

      if (r.members.filter((m) => !m.spectator).length >= MAX_PLAYERS) {
        send(member.ws, { t: "error", msg: "Salon plein." });
        return;
      }
      r.members.push(member);
      room.current = r;
      sendLobby(r);
      break;
    }

    case "start": {
      const r = room.current;
      if (!r || r.game) return;
      if (r.members.filter((m) => !m.spectator)[0] !== member) return; // host only
      startGame(r);
      break;
    }

    case "attack": {
      const r = room.current;
      if (!r || !r.game || member.spectator || member.id < 0) return;
      const p = r.game.players[member.id];
      if (!p || !p.alive) return;
      const tile = msg.tile | 0;
      if (tile < 0 || tile >= r.game.owner.length) return;
      if (r.game.terrain[tile] !== 1) return;
      const o = r.game.owner[tile];
      if (o === member.id) return;
      const ratio = Math.max(0.01, Math.min(1, Number(msg.ratio) || 0.5));
      const target = o === NEUTRAL ? NEUTRAL : o;
      r.game.launchAttack(member.id, target, ratio);
      break;
    }

    case "leave": {
      dropMember(member, room);
      break;
    }
  }
}

function statsOf(game: Game): Array<[number, number, number]> {
  return game.players.map((p) => [Math.round(p.troops), p.tiles, p.alive ? 1 : 0]);
}

function dropMember(member: Member, room: { current: Room | null }) {
  const r = room.current;
  if (!r) return;
  const idx = r.members.indexOf(member);
  if (idx >= 0) r.members.splice(idx, 1);

  if (r.game && !member.spectator && member.id >= 0) {
    // Hand the disconnected player over to the AI.
    const p = r.game.players[member.id];
    if (p && p.alive) p.isBot = true;
  }

  // No connections left → tear the room down.
  if (r.members.length === 0) {
    if (r.timer) clearInterval(r.timer);
    rooms.delete(r.code);
  } else if (!r.game) {
    sendLobby(r); // host may have changed
  }
  room.current = null;
}

// ------------------------------------------------------------------ transport
const httpServer = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  // Static file serving of the built client (optional).
  try {
    let rel = decodeURIComponent(url);
    if (rel === "/" || rel === "") rel = "/index.html";
    const path = normalize(join(DIST, rel));
    if (!path.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    const buf = await readFile(path).catch(async () => readFile(join(DIST, "index.html")));
    res.writeHead(200, { "content-type": contentType(path) });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("FrontFritas server — build the client (npm run build) to serve it here.");
  }
});

function contentType(p: string): string {
  switch (extname(p)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript";
    case ".css": return "text/css";
    case ".json": return "application/json";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (ws) => {
  const member: Member = { ws, name: "Joueur", color: [200, 200, 200], id: -1, spectator: false };
  const roomRef = { current: null as Room | null };

  ws.on("message", (data) => handle(member, roomRef, data.toString()));
  ws.on("close", () => dropMember(member, roomRef));
  ws.on("error", () => dropMember(member, roomRef));
});

httpServer.listen(PORT, () => {
  console.log(`FrontFritas server on http://localhost:${PORT}  (ws + static)`);
});
