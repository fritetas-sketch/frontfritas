import { Game, LAND, NEUTRAL } from "./game.ts";

const WATER_DEEP = [12, 26, 54];
const WATER_SHALLOW = [24, 52, 92];
const NEUTRAL_LAND = [78, 92, 66];

export interface Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private img: ImageData;
  cam: Camera = { scale: 1, offsetX: 0, offsetY: 0 };

  constructor(canvas: HTMLCanvasElement, private game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.buffer = document.createElement("canvas");
    this.buffer.width = game.w;
    this.buffer.height = game.h;
    this.bctx = this.buffer.getContext("2d")!;
    this.img = this.bctx.createImageData(game.w, game.h);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Fit the whole map into the viewport. */
  fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / this.game.w, vh / this.game.h) * 0.96;
    this.cam.scale = scale;
    this.cam.offsetX = (vw - this.game.w * scale) / 2;
    this.cam.offsetY = (vh - this.game.h * scale) / 2;
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.cam.offsetX) / this.cam.scale,
      y: (sy - this.cam.offsetY) / this.cam.scale,
    };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToTile(sx, sy);
    this.cam.scale = Math.max(0.5, Math.min(40, this.cam.scale * factor));
    this.cam.offsetX = sx - before.x * this.cam.scale;
    this.cam.offsetY = sy - before.y * this.cam.scale;
  }

  /** Repaint the map pixel buffer (only when the game marks itself dirty). */
  rebuild() {
    const g = this.game;
    const data = this.img.data;
    const { owner, terrain, shade } = g;

    for (let i = 0; i < owner.length; i++) {
      let r: number, gg: number, b: number;

      if (terrain[i] !== LAND) {
        // Water — slightly lighter near land for a coastline feel.
        const s = shade[i];
        r = WATER_DEEP[0] + (WATER_SHALLOW[0] - WATER_DEEP[0]) * (s - 0.85);
        gg = WATER_DEEP[1] + (WATER_SHALLOW[1] - WATER_DEEP[1]) * (s - 0.85);
        b = WATER_DEEP[2] + (WATER_SHALLOW[2] - WATER_DEEP[2]) * (s - 0.85);
      } else if (owner[i] === NEUTRAL) {
        const s = shade[i];
        r = NEUTRAL_LAND[0] * s;
        gg = NEUTRAL_LAND[1] * s;
        b = NEUTRAL_LAND[2] * s;
      } else {
        const p = g.players[owner[i]];
        // Border tile? (any 4-neighbor with a different owner)
        if (this.isBorder(i, owner)) {
          r = p.border[0];
          gg = p.border[1];
          b = p.border[2];
        } else {
          const s = shade[i];
          r = p.color[0] * s;
          gg = p.color[1] * s;
          b = p.color[2] * s;
        }
      }

      const o = i * 4;
      data[o] = r;
      data[o + 1] = gg;
      data[o + 2] = b;
      data[o + 3] = 255;
    }

    this.bctx.putImageData(this.img, 0, 0);
  }

  private isBorder(i: number, owner: Int16Array): boolean {
    const w = this.game.w;
    const x = i % w;
    const o = owner[i];
    if (x > 0 && owner[i - 1] !== o) return true;
    if (x < w - 1 && owner[i + 1] !== o) return true;
    if (i - w >= 0 && owner[i - w] !== o) return true;
    if (i + w < owner.length && owner[i + w] !== o) return true;
    return false;
  }

  draw() {
    const ctx = this.ctx;
    const g = this.game;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.buffer,
      this.cam.offsetX,
      this.cam.offsetY,
      g.w * this.cam.scale,
      g.h * this.cam.scale,
    );

    // Player name labels at centroids (only reasonably large territories).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const minTiles = (g.w * g.h) / 900;
    for (const p of g.players) {
      if (!p.alive || p.tiles < minTiles) continue;
      const [cx, cy] = g.centroids[p.id];
      const x = this.cam.offsetX + cx * this.cam.scale;
      const y = this.cam.offsetY + cy * this.cam.scale;
      const size = Math.max(10, Math.min(22, Math.sqrt(p.tiles) * 0.6));
      ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(2, size / 7);
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.fillStyle = "#fff";
      ctx.strokeText(p.name, x, y);
      ctx.fillText(p.name, x, y);
    }
  }
}
