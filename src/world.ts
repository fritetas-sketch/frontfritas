import { generateTerrain } from "./mapgen.ts";
import { darken } from "./palette.ts";
import { mulberry32 } from "./rng.ts";
import type { RosterEntry } from "./protocol.ts";
import { NEUTRAL, type Player } from "./types.ts";

/** The read-only shape the Renderer needs. Both `Game` (solo, server) and
 *  `ClientWorld` (networked client) satisfy it. */
export interface WorldView {
  w: number;
  h: number;
  terrain: Uint8Array;
  owner: Int16Array;
  shade: Float32Array;
  players: Player[];
  centroids: Array<[number, number]>;
}

/**
 * Client-side view of a networked game. It regenerates the terrain locally
 * from the shared seed (mapgen is deterministic) and keeps its `owner` array
 * in sync from server deltas — it never runs the simulation itself.
 */
export class ClientWorld implements WorldView {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  readonly owner: Int16Array;
  readonly shade: Float32Array;
  readonly players: Player[] = [];
  readonly centroids: Array<[number, number]> = [];

  gameOver = false;
  winnerId = -1;
  winnerName = "";
  youId: number;
  dirty = true;
  private tickCount = 0;

  constructor(w: number, h: number, seed: number, roster: RosterEntry[], you: number) {
    this.w = w;
    this.h = h;
    this.youId = you;
    this.terrain = generateTerrain(w, h, seed);

    const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.shade = new Float32Array(w * h);
    for (let i = 0; i < this.shade.length; i++) this.shade[i] = 0.88 + rand() * 0.24;

    this.owner = new Int16Array(w * h).fill(NEUTRAL);

    for (const r of roster) {
      this.players.push({
        id: r.id,
        name: r.name,
        color: r.color,
        border: darken(r.color),
        isBot: r.isBot,
        troops: 0,
        tiles: 0,
        alive: true,
        cooldown: 0,
      });
      this.centroids.push([0, 0]);
    }
  }

  /** Replace the whole owner array from a base64 Int16 snapshot. */
  applySnapshot(b64: string) {
    const bytes = base64ToBytes(b64);
    const snap = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    this.owner.set(snap.subarray(0, this.owner.length));
    this.dirty = true;
  }

  /** Apply owner deltas: flat [index, owner, index, owner, ...]. */
  applyDeltas(d: number[]) {
    for (let i = 0; i < d.length; i += 2) this.owner[d[i]] = d[i + 1];
    if (d.length) this.dirty = true;
  }

  /** Update per-player stats: [troops, tiles, alive]. */
  applyStats(stats: Array<[number, number, number]>) {
    for (let id = 0; id < stats.length && id < this.players.length; id++) {
      const p = this.players[id];
      p.troops = stats[id][0];
      p.tiles = stats[id][1];
      p.alive = stats[id][2] === 1;
    }
    this.tickCount++;
    if (this.tickCount % 8 === 0) this.updateCentroids();
  }

  private updateCentroids() {
    const n = this.players.length;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    const cnt = new Int32Array(n);
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o < 0 || o >= n) continue;
      sx[o] += i % this.w;
      sy[o] += (i / this.w) | 0;
      cnt[o]++;
    }
    for (let id = 0; id < n; id++) {
      if (cnt[id] > 0) this.centroids[id] = [sx[id] / cnt[id], sy[id] / cnt[id]];
    }
  }

  aliveCount(): number {
    return this.players.filter((p) => p.alive).length;
  }

  leaderboard(): Player[] {
    return this.players.filter((p) => p.alive).sort((a, b) => b.tiles - a.tiles);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
