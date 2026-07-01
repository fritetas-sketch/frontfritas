import "./style.css";
import { Game } from "./game.ts";
import { fillBots, PALETTE } from "./palette.ts";
import { Renderer } from "./render.ts";
import { ClientWorld, type WorldView } from "./world.ts";
import { Net, defaultWsUrl } from "./net.ts";
import { SIZES } from "./protocol.ts";
import { initDiscord } from "./discord.ts";
import { NEUTRAL, type PlayerDesc, type RGB } from "./types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $("game") as HTMLCanvasElement;
const hud = $("hud");
const menu = $("menu");
const lobby = $("lobby");
const gameover = $("gameover");

// ---- menu state -------------------------------------------------------
let selectedColor: RGB = PALETTE[4]; // yellow by default
let attackRatio = 0.5;

const colorPicker = $("color-picker");
PALETTE.slice(0, 12).forEach((c, idx) => {
  const dot = document.createElement("div");
  dot.className = "color-dot" + (idx === 4 ? " selected" : "");
  dot.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
  dot.onclick = () => {
    selectedColor = c;
    document.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("selected"));
    dot.classList.add("selected");
  };
  colorPicker.appendChild(dot);
});

const botsInput = $("bots-input") as HTMLInputElement;
const botsVal = $("bots-val");
botsInput.oninput = () => (botsVal.textContent = botsInput.value);

const ratioInput = $("ratio") as HTMLInputElement;
const ratioVal = $("ratio-val");
ratioInput.oninput = () => {
  attackRatio = parseInt(ratioInput.value) / 100;
  ratioVal.textContent = ratioInput.value + "%";
};

initDiscord((name) => {
  ($("name-input") as HTMLInputElement).value = name.slice(0, 14);
});

function playerName(): string {
  return ($("name-input") as HTMLInputElement).value.trim() || "Toi";
}
function menuError(msg: string) {
  const el = $("menu-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

// ---- session state ----------------------------------------------------
let renderer: Renderer | null = null;
let solo: Game | null = null; // set in solo mode
let world: ClientWorld | null = null; // set in multiplayer mode
let net: Net | null = null;
let myId = 0; // player id we control (-1 = spectator)
let lastTime = 0;
let acc = 0;
const TICK = 0.1;

function activeView(): WorldView | null {
  return (solo ?? world) as WorldView | null;
}
function isOver(): boolean {
  return solo ? solo.gameOver : world ? world.gameOver : false;
}

// ---- solo -------------------------------------------------------------
$("play-btn").onclick = () => {
  const bots = parseInt(botsInput.value);
  const size = ($("size-input") as HTMLSelectElement).value;
  const [w, h] = SIZES[size] ?? SIZES.medium;
  const seed = (Date.now() ^ (Math.floor(performance.now() * 2654435761))) >>> 0;

  const human: PlayerDesc = { name: playerName(), color: selectedColor, isBot: false };
  const roster = fillBots([human], bots);

  const g = new Game({ width: w, height: h, seed, roster });
  g.humanId = 0;
  solo = g;
  world = null;
  myId = 0;
  enterGame(g);
};

// ---- multiplayer ------------------------------------------------------
function connect(): Promise<Net> {
  return new Promise((resolve, reject) => {
    const n = new Net(defaultWsUrl(), {
      onLobby: showLobby,
      onStart: onStart,
      onState: onState,
      onError: (m) => menuError(m),
      onClose: onNetClose,
    });
    n.connect()
      .then(() => resolve(n))
      .catch(reject);
  });
}

$("host-btn").onclick = async () => {
  menuError("");
  try {
    net = await connect();
    net.send({
      t: "create",
      name: playerName(),
      color: selectedColor,
      config: { size: ($("size-input") as HTMLSelectElement).value, bots: parseInt(botsInput.value) },
    });
  } catch {
    menuError("Serveur multijoueur injoignable. Lance `npm run server`.");
  }
};

$("join-btn").onclick = async () => {
  const code = ($("code-input") as HTMLInputElement).value.trim().toUpperCase();
  if (code.length < 3) return menuError("Entre un code de salon.");
  menuError("");
  try {
    net = await connect();
    net.send({ t: "join", code, name: playerName(), color: selectedColor });
  } catch {
    menuError("Serveur multijoueur injoignable. Lance `npm run server`.");
  }
};

let iAmHost = false;
function showLobby(m: import("./protocol.ts").S2C & { t: "lobby" }) {
  iAmHost = m.host;
  menu.classList.add("hidden");
  lobby.classList.remove("hidden");
  $("lobby-code").textContent = m.code;

  const list = $("lobby-members");
  list.innerHTML = m.members
    .map((mem) => {
      const [r, g, b] = mem.color;
      return `<div class="member">
        <span class="lb-swatch" style="background:rgb(${r},${g},${b})"></span>
        <span>${escapeHtml(mem.name)}</span>
        ${mem.host ? '<span class="host-tag">hôte</span>' : ""}
      </div>`;
    })
    .join("");

  $("lobbystart-btn").classList.toggle("hidden", !m.host);
  $("lobby-wait").classList.toggle("hidden", m.host);
}

$("lobbystart-btn").onclick = () => {
  if (net && iAmHost) net.send({ t: "start" });
};
$("lobbyleave-btn").onclick = () => {
  net?.send({ t: "leave" });
  net?.close();
  net = null;
  backToMenu();
};

function onStart(m: import("./protocol.ts").S2C & { t: "start" }) {
  const cw = new ClientWorld(m.width, m.height, m.seed, m.roster, m.you);
  world = cw;
  solo = null;
  myId = m.you;
  lobby.classList.add("hidden");
  enterGame(cw);
}

function onState(m: import("./protocol.ts").S2C & { t: "state" }) {
  if (!world) return;
  if (m.full) world.applySnapshot(m.full);
  if (m.d) world.applyDeltas(m.d);
  world.applyStats(m.stats);
  if (m.over) {
    world.gameOver = true;
    world.winnerId = m.over.winner;
    world.winnerName = m.over.name;
  }
}

function onNetClose() {
  if (world && !world.gameOver) {
    // Lost connection mid-game.
    menuError("");
    backToMenu();
  }
}

// ---- shared game flow -------------------------------------------------
function enterGame(view: WorldView) {
  renderer = new Renderer(canvas, view);
  renderer.resize();
  renderer.fit();
  renderer.rebuild();
  menu.classList.add("hidden");
  lobby.classList.add("hidden");
  gameover.classList.add("hidden");
  hud.classList.remove("hidden");
  lastTime = performance.now();
  acc = 0;
  requestAnimationFrame(loop);
}

function backToMenu() {
  hud.classList.add("hidden");
  lobby.classList.add("hidden");
  gameover.classList.add("hidden");
  menu.classList.remove("hidden");
  renderer = null;
  solo = null;
  world = null;
}

$("replay-btn").onclick = () => {
  net?.close();
  net = null;
  backToMenu();
};

function loop(now: number) {
  const view = activeView();
  if (!renderer || !view) return;

  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (solo) {
    acc += dt;
    while (acc >= TICK) {
      solo.tick(TICK);
      acc -= TICK;
    }
  }

  const dirty = solo ? solo.dirty : world ? world.dirty : false;
  if (dirty) {
    renderer.rebuild();
    if (solo) solo.dirty = false;
    if (world) world.dirty = false;
  }
  renderer.draw();
  updateHud(view);

  if (isOver() || (solo && !solo.players[myId]?.alive)) {
    showGameOver();
    return;
  }
  requestAnimationFrame(loop);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return Math.floor(n).toString();
}

function updateHud(view: WorldView) {
  const me = myId >= 0 ? view.players[myId] : undefined;
  $("stat-troops").textContent = me ? fmt(me.troops) : "—";
  $("stat-tiles").textContent = me ? fmt(me.tiles) : "—";
  const alive = view.players.filter((p) => p.alive).length;
  $("stat-alive").textContent = alive.toString();

  const rows = [...view.players]
    .filter((p) => p.alive)
    .sort((a, b) => b.tiles - a.tiles)
    .slice(0, 8);
  const total = view.w * view.h;
  $("leaderboard").innerHTML = rows
    .map((p) => {
      const pct = ((p.tiles / total) * 100).toFixed(1);
      const [r, g, b] = p.color;
      return `<div class="lb-row ${p.id === myId ? "me" : ""}">
        <span class="lb-swatch" style="background:rgb(${r},${g},${b})"></span>
        <span class="lb-name">${escapeHtml(p.name)}</span>
        <span class="lb-val">${pct}%</span>
      </div>`;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function showGameOver() {
  const title = $("go-title");
  const sub = $("go-sub");
  let winnerId = -1;
  let winnerName = "";
  if (solo) {
    winnerId = solo.winnerId;
    winnerName = winnerId >= 0 ? solo.players[winnerId].name : "";
  } else if (world) {
    winnerId = world.winnerId;
    winnerName = world.winnerName;
  }

  if (myId >= 0 && winnerId === myId) {
    title.textContent = "🏆 Victoire !";
    sub.textContent = "Tu as conquis la carte.";
  } else if (winnerId >= 0) {
    title.textContent = myId >= 0 ? "💀 Éliminé" : "Partie terminée";
    sub.textContent = `${winnerName} domine le champ de bataille.`;
  } else {
    title.textContent = "Partie terminée";
    sub.textContent = "";
  }
  gameover.classList.remove("hidden");
}

// ---- input ------------------------------------------------------------
let dragging = false;
let dragMoved = false;
let lastX = 0;
let lastY = 0;
let downX = 0;
let downY = 0;

canvas.addEventListener("mousedown", (e) => {
  if (!renderer) return;
  if (e.button === 0) {
    downX = e.clientX;
    downY = e.clientY;
    dragging = true;
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
  } else if (e.button === 2) {
    dragging = true;
    dragMoved = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

window.addEventListener("mousemove", (e) => {
  if (!dragging || !renderer) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) {
    renderer.cam.offsetX += dx;
    renderer.cam.offsetY += dy;
    if (e.buttons & 1) dragMoved = true;
  }
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mouseup", (e) => {
  if (renderer && e.button === 0 && dragging && !dragMoved) handleClick(e.clientX, e.clientY);
  dragging = false;
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!renderer) return;
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);

function handleClick(sx: number, sy: number) {
  const view = activeView();
  if (!view || !renderer || myId < 0) return; // spectators can't attack
  const { x, y } = renderer.screenToTile(sx, sy);
  if (x < 0 || y < 0 || x >= view.w || y >= view.h) return;
  const tile = (y | 0) * view.w + (x | 0);
  if (view.terrain[tile] !== 1) return; // water
  const owner = view.owner[tile];
  if (owner === myId) return;

  if (solo) {
    const target = owner === NEUTRAL ? NEUTRAL : owner;
    solo.launchAttack(myId, target, attackRatio);
  } else if (net) {
    net.send({ t: "attack", tile, ratio: attackRatio });
  }
}

// Keyboard pan
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
setInterval(() => {
  if (!renderer) return;
  const step = 26;
  if (keys.has("arrowleft") || keys.has("a") || keys.has("q")) renderer.cam.offsetX += step;
  if (keys.has("arrowright") || keys.has("d")) renderer.cam.offsetX -= step;
  if (keys.has("arrowup") || keys.has("w") || keys.has("z")) renderer.cam.offsetY += step;
  if (keys.has("arrowdown") || keys.has("s")) renderer.cam.offsetY -= step;
}, 16);

window.addEventListener("resize", () => renderer?.resize());

// Prefill a join code from the URL (?room=CODE) for easy viewer links.
{
  const room = new URLSearchParams(window.location.search).get("room");
  if (room) ($("code-input") as HTMLInputElement).value = room.toUpperCase().slice(0, 4);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
