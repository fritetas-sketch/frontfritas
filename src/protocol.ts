import type { RGB } from "./types.ts";

/** Map sizes shared by solo and multiplayer. */
export const SIZES: Record<string, [number, number]> = {
  small: [160, 110],
  medium: [220, 150],
  large: [300, 200],
};
export type SizeKey = keyof typeof SIZES;

export interface RoomConfig {
  size: string;
  bots: number;
}

export interface LobbyMember {
  name: string;
  color: RGB;
  host: boolean;
}

export interface RosterEntry {
  id: number;
  name: string;
  color: RGB;
  isBot: boolean;
}

/** Client → Server messages. */
export type C2S =
  | { t: "create"; name: string; color: RGB; config: RoomConfig }
  | { t: "join"; code: string; name: string; color: RGB }
  | { t: "start" }
  | { t: "attack"; tile: number; ratio: number }
  | { t: "leave" };

/** Server → Client messages. */
export type S2C =
  | { t: "lobby"; code: string; host: boolean; members: LobbyMember[]; config: RoomConfig }
  | {
      t: "start";
      code: string;
      seed: number;
      width: number;
      height: number;
      roster: RosterEntry[];
      you: number; // -1 for spectators
    }
  | {
      t: "state";
      // per-player stats in id order: [troops, tiles, alive(0|1)]
      stats: Array<[number, number, number]>;
      d?: number[]; // owner deltas: [index, owner, index, owner, ...]
      full?: string; // base64 Int16 owner snapshot (used for resync)
      over?: { winner: number; name: string };
    }
  | { t: "error"; msg: string };
