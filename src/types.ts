export type RGB = [number, number, number];

export interface Player {
  id: number;
  name: string;
  color: RGB;
  /** Slightly darkened color used for territory borders. */
  border: RGB;
  isBot: boolean;
  troops: number;
  tiles: number;
  alive: boolean;
  /** Bot cooldown (seconds) before it thinks again. */
  cooldown: number;
}

export interface Attack {
  attacker: number;
  /** Target player id, or -1 to expand into neutral (unowned) land. */
  target: number;
  /** Remaining army committed to this attack. */
  army: number;
  /** BFS frontier of tile indices still to be conquered. */
  frontier: number[];
  /** Read cursor into `frontier` (avoids expensive Array.shift). */
  head: number;
  /** Membership set to keep the frontier free of duplicates. */
  seen: Set<number>;
}

export interface GameConfig {
  width: number;
  height: number;
  bots: number;
  playerName: string;
  playerColor: RGB;
  seed: number;
}

export const WATER = 0;
export const LAND = 1;

/** owner value meaning "land that belongs to no one yet". */
export const NEUTRAL = -1;
