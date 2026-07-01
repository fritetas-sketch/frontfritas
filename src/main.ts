import "./style.css";
import { Game } from "./game.ts";
import { NEUTRAL } from "./types.ts";
import { PALETTE } from "./palette.ts";
import { Renderer } from "./render.ts";
import { initDiscord } from "./discord.ts";
import type { RGB } from "./types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $("game") as HTMLCanvasElement;
const hud = $("hud");
const menu = $("menu");
const gameover = $("gameover");

// ---- menu state -------------------------------------------------------
let selectedColor: RGB = PALETTE[4]; // yellow by default
let attackRatio = 0.5;

// Color picker
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

// Discord login (optional; enabled only if a client id is configured)
initDiscord((name) => {
  ($("name-input") as HTMLInputElement).value = name.slice(0, 14);
});

// ---- game lifecycle ---------------------------------------------------
let game: Game | null = null;
let renderer: Renderer | null = null;
let lastTime = 0;
let acc = 0;
const TICK = 0.1; // seconds per simulation tick

const SIZES: Record<string, [number, number]> = {
  small: [160, 110],
  medium: [220, 150],
  large: [300, 200],
};

function startGame() {
  const name = ($("name-input") as HTMLInputElement).value.trim() || "Toi";
  const bots = parseInt(botsInput.value);
  const size = ($("size-input") as HTMLSelectElement).value;
  const [w, h] = SIZES[size] ?? SIZES.medium;
  const seed = (Math.floor(Date.now()) ^ (Math.floor(performance.now()) * 2654435761)) >>> 0;

  game = new Game({ width: w, height: h, bots, playerName: name, playerColor: selectedColor, seed });
  renderer = new Renderer(canvas, game);
  renderer.resize();
  renderer.fit();
  renderer.rebuild();

  menu.classList.add("hidden");
  gameover.classList.add("hidden");
  hud.classList.remove("hidden");

  lastTime = performance.now();
  acc = 0;
  requestAnimationFrame(loop);
}

$("play-btn").onclick = startGame;
$("replay-btn").onclick = () => {
  gameover.classList.add("hidden");
  menu.classList.remove("hidden");
  hud.classList.add("hidden");
  game = null;
};

// ---- main loop --------------------------------------------------------
function loop(now: number) {
  if (!game || !renderer) return;
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  acc += dt;

  while (acc >= TICK) {
    game.tick(TICK);
    acc -= TICK;
  }

  if (game.dirty) {
    renderer.rebuild();
    game.dirty = false;
  }
  renderer.draw();
  updateHud();

  if (game.gameOver) {
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

function updateHud() {
  if (!game) return;
  const me = game.players[game.humanId];
  $("stat-troops").textContent = fmt(me.troops);
  $("stat-tiles").textContent = fmt(me.tiles);
  $("stat-alive").textContent = game.aliveCount().toString();

  const lb = $("leaderboard");
  const rows = game.leaderboard().slice(0, 8);
  const totalLand = game.w * game.h;
  lb.innerHTML = rows
    .map((p) => {
      const pct = ((p.tiles / totalLand) * 100).toFixed(1);
      const [r, g, b] = p.color;
      return `<div class="lb-row ${p.id === game!.humanId ? "me" : ""}">
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
  if (game!.won) {
    title.textContent = "🏆 Victoire !";
    sub.textContent = "Tu as conquis la carte.";
  } else {
    title.textContent = "💀 Éliminé";
    const winner = game!.players.filter((p) => p.alive).sort((a, b) => b.tiles - a.tiles)[0];
    sub.textContent = winner ? `${winner.name} domine le champ de bataille.` : "Ton territoire a disparu.";
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
    dragMoved = true; // right-drag always pans, never attacks
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

window.addEventListener("mousemove", (e) => {
  if (!dragging || !renderer) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) {
    // Panning with primary button only once it clearly moves.
    renderer.cam.offsetX += dx;
    renderer.cam.offsetY += dy;
    if (e.buttons & 1) dragMoved = true;
  }
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mouseup", (e) => {
  if (!renderer || !game) {
    dragging = false;
    return;
  }
  if (e.button === 0 && dragging && !dragMoved) {
    handleClick(e.clientX, e.clientY);
  }
  dragging = false;
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (e) => {
    if (!renderer) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    renderer.zoomAt(e.clientX, e.clientY, factor);
  },
  { passive: false },
);

function handleClick(sx: number, sy: number) {
  if (!game || !renderer) return;
  const { x, y } = renderer.screenToTile(sx, sy);
  const tile = game.tileAt(x, y);
  if (tile < 0) return;
  const owner = game.owner[tile];
  const me = game.humanId;

  if (owner === me) return; // clicking own land does nothing
  if (game.terrain[tile] !== 1) return; // water

  const target = owner === NEUTRAL ? NEUTRAL : owner;
  game.launchAttack(me, target, attackRatio);
}

// Keyboard pan (ZQSD / WASD / arrows)
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

window.addEventListener("resize", () => {
  if (renderer) renderer.resize();
});

// Make sure the canvas is sized even on the menu (for a nice backdrop later).
{
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
