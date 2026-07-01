import { mulberry32 } from "./rng.ts";
import { LAND, WATER } from "./types.ts";

/**
 * Generates an organic land/water map using cellular automata.
 * Returns a Uint8Array of WATER/LAND with a guaranteed water margin so
 * territories never touch the map edge awkwardly.
 */
export function generateTerrain(w: number, h: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  let map: Uint8Array = new Uint8Array(w * h);

  // Seed with random noise, biased toward land in the interior.
  const margin = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edge =
        x < margin || y < margin || x >= w - margin || y >= h - margin;
      if (edge) {
        map[i] = WATER;
      } else {
        // Radial falloff makes the center more likely to be land -> island-y.
        const dx = (x - w / 2) / (w / 2);
        const dy = (y - h / 2) / (h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const landChance = 0.62 - dist * 0.28;
        map[i] = rand() < landChance ? LAND : WATER;
      }
    }
  }

  // Smooth with a few CA passes: a cell becomes land if most neighbors are land.
  for (let pass = 0; pass < 5; pass++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < margin || y < margin || x >= w - margin || y >= h - margin) {
          next[i] = WATER;
          continue;
        }
        let land = 0;
        for (let ny = -1; ny <= 1; ny++) {
          for (let nx = -1; nx <= 1; nx++) {
            if (nx === 0 && ny === 0) continue;
            if (map[(y + ny) * w + (x + nx)] === LAND) land++;
          }
        }
        if (map[i] === LAND) next[i] = land >= 4 ? LAND : WATER;
        else next[i] = land >= 5 ? LAND : WATER;
      }
    }
    map = next;
  }

  // Remove tiny puddles of water fully surrounded by land (fill them in),
  // and tiny islets (drop them) so the board reads cleanly.
  map = removeSpecks(map, w, h);
  return map;
}

function removeSpecks(map: Uint8Array, w: number, h: number): Uint8Array {
  const out = map.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let land = 0;
      for (let ny = -1; ny <= 1; ny++) {
        for (let nx = -1; nx <= 1; nx++) {
          if (nx === 0 && ny === 0) continue;
          if (map[(y + ny) * w + (x + nx)] === LAND) land++;
        }
      }
      if (land === 8) out[i] = LAND; // fill single-tile lake
      if (land === 0) out[i] = WATER; // drop single-tile islet
    }
  }
  return out;
}
