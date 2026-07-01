import { generateTerrain } from "./mapgen.ts";
import { darken, freeColor } from "./palette.ts";
import { mulberry32 } from "./rng.ts";
import {
  type Attack,
  type GameConfig,
  LAND,
  NEUTRAL,
  type Player,
  WATER,
} from "./types.ts";

/** Tuning constants — tweak to change the feel of the game. */
const CFG = {
  troopCapPerTile: 11,
  troopCapBase: 120,
  growthRate: 0.028, // logistic growth toward the cap
  flatGrowth: 0.02, // small growth proportional to tiles
  neutralCostBase: 1.1,
  neutralCostPerTile: 0.02, // expansion gets pricier as you grow
  enemyDefenseMult: 1.4,
  conquerPerTick: 26, // tiles processed per attack per tick (animation speed)
  startTroops: 260,
  startRadius: 4,
};

export class Game {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  readonly owner: Int16Array;
  /** Per-tile brightness jitter (0..1) so land/territory has texture. */
  readonly shade: Float32Array;

  readonly players: Player[] = [];
  readonly attacks = new Map<number, Attack>();
  /** Which player id the local UI controls (solo). Ignored server-side. */
  humanId = 0;

  gameOver = false;
  /** Id of the winning player once the game is over, else -1. */
  winnerId = -1;
  /** Set true whenever the map buffer needs re-rendering. */
  dirty = true;

  private rand: () => number;
  private tickCount = 0;
  /** Cached centroids for name labels: [x, y] per player id. */
  readonly centroids: Array<[number, number]> = [];

  constructor(cfg: GameConfig) {
    this.w = cfg.width;
    this.h = cfg.height;
    this.rand = mulberry32(cfg.seed ^ 0x9e3779b9);

    this.terrain = generateTerrain(cfg.width, cfg.height, cfg.seed);
    this.owner = new Int16Array(cfg.width * cfg.height).fill(NEUTRAL);

    this.shade = new Float32Array(cfg.width * cfg.height);
    for (let i = 0; i < this.shade.length; i++) {
      this.shade[i] = 0.88 + this.rand() * 0.24;
    }

    this.createPlayers(cfg);
    this.spawnPlayers();
  }

  // ---------------------------------------------------------------- players
  private createPlayers(cfg: GameConfig) {
    const usedColors = new Set<string>();
    const key = (c: number[]) => c.join(",");

    cfg.roster.forEach((desc, id) => {
      // Ensure every player has a unique color (fixes clashes between humans).
      let color = desc.color;
      if (usedColors.has(key(color))) color = freeColor(usedColors, id);
      usedColors.add(key(color));

      this.players.push({
        id,
        name: desc.name || (desc.isBot ? "Bot" : "Joueur"),
        color,
        border: darken(color),
        isBot: desc.isBot,
        troops: CFG.startTroops,
        tiles: 0,
        alive: true,
        cooldown: desc.isBot ? this.rand() * 2 : 0,
      });
    });

    this.centroids.length = this.players.length;
    for (let i = 0; i < this.players.length; i++) this.centroids[i] = [0, 0];
  }

  private spawnPlayers() {
    const spots: number[] = [];
    const minDist = Math.max(this.w, this.h) / (this.players.length * 0.5 + 3);
    const r = CFG.startRadius;
    // A good spot has mostly-land surroundings so everyone gets a fair start.
    const minLand = Math.floor((r * r * Math.PI) * 0.62);

    for (const p of this.players) {
      let best = -1;
      let bestLand = -1;
      for (let tries = 0; tries < 3000; tries++) {
        const x = Math.floor(this.rand() * this.w);
        const y = Math.floor(this.rand() * this.h);
        const i = y * this.w + x;
        if (this.terrain[i] !== LAND || this.owner[i] !== NEUTRAL) continue;

        let ok = true;
        for (const s of spots) {
          if (Math.hypot((s % this.w) - x, ((s / this.w) | 0) - y) < minDist) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        const land = this.landAround(x, y, r);
        if (land > bestLand) {
          bestLand = land;
          best = i;
          if (land >= minLand) break; // good enough, stop searching
        }
      }
      if (best >= 0) {
        this.claimBlob(best % this.w, (best / this.w) | 0, r, p.id);
        spots.push(best);
      } else {
        // Fallback: any free land tile.
        for (let i = 0; i < this.terrain.length; i++) {
          if (this.terrain[i] === LAND && this.owner[i] === NEUTRAL) {
            this.claimBlob(i % this.w, (i / this.w) | 0, 2, p.id);
            spots.push(i);
            break;
          }
        }
      }
    }
    this.dirty = true;
  }

  private landAround(cx: number, cy: number, r: number): number {
    let land = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if (this.terrain[y * this.w + x] === LAND) land++;
      }
    }
    return land;
  }

  private claimBlob(cx: number, cy: number, r: number, id: number) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = y * this.w + x;
        if (this.terrain[i] !== LAND) continue;
        if (this.owner[i] === NEUTRAL) {
          this.owner[i] = id;
          this.players[id].tiles++;
        }
      }
    }
  }

  // ------------------------------------------------------------------- utils
  private neighbors(i: number): number[] {
    const x = i % this.w;
    const y = (i / this.w) | 0;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < this.w - 1) out.push(i + 1);
    if (y > 0) out.push(i - this.w);
    if (y < this.h - 1) out.push(i + this.w);
    return out;
  }

  maxTroops(p: Player): number {
    return CFG.troopCapBase + p.tiles * CFG.troopCapPerTile;
  }

  tileAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return (y | 0) * this.w + (x | 0);
  }

  // -------------------------------------------------------------- attack API
  /** Launch an attack from `attacker` toward `target` (id, or NEUTRAL). */
  launchAttack(attacker: number, target: number, ratio: number) {
    const p = this.players[attacker];
    if (!p.alive) return;

    // A new attack replaces the old one; refund the old army first.
    const prev = this.attacks.get(attacker);
    if (prev) p.troops += prev.army;

    const army = p.troops * ratio;
    if (army < 1) {
      this.attacks.delete(attacker);
      return;
    }
    p.troops -= army;

    const atk: Attack = {
      attacker,
      target,
      army,
      frontier: [],
      head: 0,
      seen: new Set(),
    };
    this.seedFrontier(atk);
    if (atk.frontier.length === 0) {
      // Nothing to attack — refund.
      p.troops += atk.army;
      this.attacks.delete(attacker);
      return;
    }
    this.attacks.set(attacker, atk);
  }

  private isValidTarget(tile: number, atk: Attack): boolean {
    if (this.terrain[tile] !== LAND) return false;
    const o = this.owner[tile];
    if (atk.target === NEUTRAL) return o === NEUTRAL;
    return o === atk.target;
  }

  private seedFrontier(atk: Attack) {
    const { attacker } = atk;
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== attacker) continue;
      for (const n of this.neighbors(i)) {
        if (!atk.seen.has(n) && this.isValidTarget(n, atk)) {
          atk.seen.add(n);
          atk.frontier.push(n);
        }
      }
    }
  }

  private processAttack(atk: Attack) {
    const attacker = this.players[atk.attacker];
    let processed = 0;

    while (
      atk.head < atk.frontier.length &&
      atk.army > 0 &&
      processed < CFG.conquerPerTick
    ) {
      const t = atk.frontier[atk.head++];
      if (!this.isValidTarget(t, atk)) continue;

      const o = this.owner[t];

      // Compute the cost first and bail out BEFORE mutating anything, so a
      // tile we can't afford never gets miscounted.
      let cost: number;
      let density = 0;
      if (o === NEUTRAL) {
        cost = CFG.neutralCostBase + attacker.tiles * CFG.neutralCostPerTile;
      } else {
        const def = this.players[o];
        density = def.troops / Math.max(1, def.tiles);
        cost = density * CFG.enemyDefenseMult + CFG.neutralCostBase;
      }

      if (atk.army < cost) {
        atk.army = 0;
        break;
      }

      // Affordable: apply the conquest.
      if (o !== NEUTRAL) {
        const def = this.players[o];
        def.troops = Math.max(0, def.troops - density);
        def.tiles--;
        if (def.tiles <= 0) this.eliminate(def);
      }

      atk.army -= cost;
      this.owner[t] = atk.attacker;
      attacker.tiles++;
      processed++;

      // Expand frontier with newly reachable target tiles.
      for (const n of this.neighbors(t)) {
        if (!atk.seen.has(n) && this.isValidTarget(n, atk)) {
          atk.seen.add(n);
          atk.frontier.push(n);
        }
      }
    }

    if (processed > 0) this.dirty = true;

    // Attack ends when out of army or frontier exhausted.
    if (atk.army <= 0 || atk.head >= atk.frontier.length) {
      if (atk.army > 0) attacker.troops += atk.army; // refund leftovers
      this.attacks.delete(atk.attacker);
    }
  }

  private eliminate(p: Player) {
    p.alive = false;
    p.troops = 0;
    this.attacks.delete(p.id);
  }

  // ------------------------------------------------------------------- ai
  /** Scan a player's border, returning whether neutral land is reachable
   *  and which enemies it touches (with contact counts). */
  private scanBorders(pid: number): {
    neutral: boolean;
    enemies: Map<number, number>;
  } {
    let neutral = false;
    const enemies = new Map<number, number>();
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] !== pid) continue;
      for (const n of this.neighbors(i)) {
        if (this.terrain[n] !== LAND) continue;
        const o = this.owner[n];
        if (o === NEUTRAL) neutral = true;
        else if (o !== pid) enemies.set(o, (enemies.get(o) ?? 0) + 1);
      }
    }
    return { neutral, enemies };
  }

  private botThink(p: Player) {
    if (this.attacks.has(p.id)) return; // already attacking
    if (p.troops < 60) {
      p.cooldown = 1.5;
      return;
    }
    const { neutral, enemies } = this.scanBorders(p.id);

    // Find the weakest beatable neighbor.
    let bestEnemy = -1;
    let bestScore = Infinity;
    for (const [eid] of enemies) {
      const e = this.players[eid];
      if (!e.alive) continue;
      const eStrength = e.troops * 0.55;
      if (p.troops <= eStrength) continue; // can't win comfortably
      const score = e.troops / Math.max(1, e.tiles); // prefer soft targets
      if (score < bestScore) {
        bestScore = score;
        bestEnemy = eid;
      }
    }

    const aggressive = this.rand() < 0.45;
    if (bestEnemy >= 0 && (aggressive || !neutral)) {
      this.launchAttack(p.id, bestEnemy, 0.6 + this.rand() * 0.3);
    } else if (neutral) {
      this.launchAttack(p.id, NEUTRAL, 0.45 + this.rand() * 0.35);
    }
    p.cooldown = 1.2 + this.rand() * 2.4;
  }

  // ------------------------------------------------------------------ tick
  /** Advance the simulation by `dt` seconds. */
  tick(dt: number) {
    if (this.gameOver) return;
    this.tickCount++;

    // Troop growth (logistic + flat).
    for (const p of this.players) {
      if (!p.alive) continue;
      const cap = this.maxTroops(p);
      const logistic =
        p.troops * CFG.growthRate * (1 - p.troops / cap) * (dt * 10);
      const flat = p.tiles * CFG.flatGrowth * (dt * 10);
      p.troops = Math.min(cap, p.troops + Math.max(0, logistic) + flat);
    }

    // Advance active attacks.
    for (const atk of [...this.attacks.values()]) this.processAttack(atk);

    // Bot decisions (staggered via per-bot cooldown; bounded per tick).
    let decisions = 0;
    for (const p of this.players) {
      if (!p.isBot || !p.alive) continue;
      p.cooldown -= dt;
      if (p.cooldown <= 0 && decisions < 3) {
        this.botThink(p);
        decisions++;
      }
    }

    // Refresh centroids for labels ~every 0.8s.
    if (this.tickCount % 8 === 0) this.updateCentroids();

    this.checkGameOver();
  }

  private updateCentroids() {
    const sx = new Float64Array(this.players.length);
    const sy = new Float64Array(this.players.length);
    const cnt = new Int32Array(this.players.length);
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o < 0) continue;
      sx[o] += i % this.w;
      sy[o] += (i / this.w) | 0;
      cnt[o]++;
    }
    for (let id = 0; id < this.players.length; id++) {
      if (cnt[id] > 0) {
        this.centroids[id] = [sx[id] / cnt[id], sy[id] / cnt[id]];
      }
    }
  }

  private checkGameOver() {
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      this.gameOver = true;
      this.winnerId = alive[0]?.id ?? -1;
    }
  }

  aliveCount(): number {
    return this.players.filter((p) => p.alive).length;
  }

  /** Players sorted by territory (desc) for the leaderboard. */
  leaderboard(): Player[] {
    return this.players
      .filter((p) => p.alive)
      .sort((a, b) => b.tiles - a.tiles);
  }
}

export { WATER, LAND, NEUTRAL };
