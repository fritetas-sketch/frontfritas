import type { RGB } from "./types.ts";

/** Distinct, readable colors for players (the human picks one, bots take the rest). */
export const PALETTE: RGB[] = [
  [231, 76, 60], // red
  [52, 152, 219], // blue
  [46, 204, 113], // green
  [155, 89, 182], // purple
  [241, 196, 15], // yellow
  [230, 126, 34], // orange
  [26, 188, 156], // teal
  [236, 64, 122], // pink
  [149, 165, 166], // gray
  [52, 73, 94], // dark slate
  [125, 206, 160], // mint
  [187, 143, 206], // lavender
  [244, 143, 177], // rose
  [133, 193, 233], // sky
  [248, 196, 113], // sand
  [88, 214, 141], // emerald
  [174, 214, 241], // pale blue
  [245, 176, 65], // amber
  [210, 180, 222], // orchid
  [169, 223, 191], // seafoam
  [127, 179, 213], // steel
  [229, 152, 102], // clay
  [186, 220, 88], // lime
  [240, 178, 122], // apricot
  [72, 201, 176], // turquoise
  [175, 122, 197], // amethyst
  [93, 173, 226], // azure
  [232, 218, 239], // lilac
  [163, 228, 215], // aqua
  [250, 215, 160], // wheat
  [213, 245, 227], // pale mint
];

const BOT_NAMES = [
  "Bourguignon", "Picardie", "Gascogne", "Savoie", "Bretagne",
  "Normandie", "Aquitaine", "Provence", "Alsace", "Lorraine",
  "Anjou", "Berry", "Auvergne", "Poitou", "Limousin",
  "Corse", "Franche", "Touraine", "Béarn", "Roussillon",
  "Nivernais", "Maine", "Artois", "Foix", "Comtat",
  "Dauphiné", "Vivarais", "Quercy", "Rouergue", "Vélay",
];

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length];
}

export function darken([r, g, b]: RGB, f = 0.55): RGB {
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}
