// Reine Layout-Logik für das Druckblatt. Alle Masse in Millimetern auf dem Papier
// bzw. Metern im Schiesskeller. Ohne React testbar.

import { OBJECT_TYPES, TARGET_VARIANTS, isShootableTarget, targetNumbers } from "./model.js";
import { center } from "./geometry.js";

export const PAGE_MARGIN_MM = 12;
const A4 = { w: 210, h: 297 };
const HEADER_MM = 30;
const FOOTER_MM = 14;
const SIDE_COLUMN_MM = 70;
const STACKED_INFO_MM = 74;
const GAP_MM = 6;
// Rand im Plan für Meterbeschriftung und Massstab (in mm, unabhängig vom Massstab)
const PLAN_PAD_MM = { left: 8, right: 3, top: 7, bottom: 12 };

export function pageContent(orientation) {
  const w = orientation === "landscape" ? A4.h : A4.w;
  const h = orientation === "landscape" ? A4.w : A4.h;
  return { w: w - PAGE_MARGIN_MM * 2, h: h - PAGE_MARGIN_MM * 2, pageW: w, pageH: h };
}

function fitScale(cellW, cellH, range) {
  const usableW = cellW - PLAN_PAD_MM.left - PLAN_PAD_MM.right;
  const usableH = cellH - PLAN_PAD_MM.top - PLAN_PAD_MM.bottom;
  return Math.max(0.1, Math.min(usableW / range.widthM, usableH / range.heightM));
}

// Wählt Ausrichtung und Anordnung so, dass der Plan möglichst gross wird.
export function choosePlanLayout(range, requested = "auto") {
  const orientations = requested === "auto" ? ["portrait", "landscape"] : [requested];
  let best = null;
  for (const orientation of orientations) {
    const page = pageContent(orientation);
    const bodyH = page.h - HEADER_MM - FOOTER_MM;
    const candidates = [
      { layout: "columns", cellW: page.w - SIDE_COLUMN_MM - GAP_MM, cellH: bodyH },
      { layout: "stacked", cellW: page.w, cellH: bodyH - STACKED_INFO_MM - GAP_MM },
    ];
    for (const c of candidates) {
      const scale = fitScale(c.cellW, c.cellH, range);
      // Hochformat leicht bevorzugen, weil es beim Drucken der Standard ist.
      const score = scale * (orientation === "portrait" ? 1.04 : 1);
      if (!best || score > best.score) best = { orientation, ...c, scale, score, page };
    }
  }
  const planW = range.widthM * best.scale + PLAN_PAD_MM.left + PLAN_PAD_MM.right;
  const planH = range.heightM * best.scale + PLAN_PAD_MM.top + PLAN_PAD_MM.bottom;
  return {
    orientation: best.orientation,
    layout: best.layout,
    page: best.page,
    mmPerM: best.scale,
    planMm: { w: planW, h: planH },
    padM: {
      left: PLAN_PAD_MM.left / best.scale,
      right: PLAN_PAD_MM.right / best.scale,
      top: PLAN_PAD_MM.top / best.scale,
      bottom: PLAN_PAD_MM.bottom / best.scale,
    },
    headerMm: HEADER_MM,
    footerMm: FOOTER_MM,
    sideColumnMm: SIDE_COLUMN_MM,
    stackedInfoMm: STACKED_INFO_MM,
    gapMm: GAP_MM,
  };
}

// Abstand der Meterbeschriftung: mindestens ca. 7 mm auf dem Papier.
export function meterStep(mmPerM) {
  return [0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => s * mmPerM >= 7) || 100;
}

// Massstabsbalken: runde Meterzahl, deren Länge auf dem Papier möglichst nahe bei 30 mm liegt.
export function scaleBar(mmPerM) {
  const target = 30 / mmPerM;
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const m = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return { meters: m, mm: m * mmPerM };
}

// Massstab als Verhältnis, gerundet auf eine übliche Zahl (nur gültig bei 100 % Druckgrösse).
export function scaleRatio(mmPerM) {
  const raw = 1000 / mmPerM;
  const nice = [25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
  return nice.find((n) => n >= raw * 0.98) || Math.round(raw);
}

const variantLabel = (v) => (TARGET_VARIANTS.find((x) => x.value === v) || {}).label || v;

// Liste aller Ziele (Papier und Stahl) mit Nummer, Typ und Position ab Kugelfang-Seite oben.
export function targetRows(stage) {
  const numbers = targetNumbers(stage);
  const rows = [];
  for (const obj of stage.objects) {
    const isPaper = ["target", "swinger", "mover"].includes(obj.type);
    const isSteel = Boolean(OBJECT_TYPES[obj.type].steelRounds);
    if (!isPaper && !isSteel && obj.type !== "activator") continue;
    const c = center(obj);
    const noShoot = isPaper && !isShootableTarget(obj);
    rows.push({
      id: obj.id,
      label: obj.label || numbers.get(obj.id) || "",
      type: noShoot ? "No-Shoot" : OBJECT_TYPES[obj.type].label,
      detail: isPaper && !noShoot && obj.properties.targetVariant !== "full" ? variantLabel(obj.properties.targetVariant) : "",
      note: isPaper ? obj.properties.targetNote || "" : "",
      rounds: noShoot ? 0 : isPaper ? stage.ammo.roundsPerTarget : OBJECT_TYPES[obj.type].steelRounds || 0,
      xM: c.x,
      yM: c.y,
      noShoot,
    });
  }
  // Nummerierte Ziele zuerst in Nummernreihenfolge, dann der Rest von links nach rechts
  return rows.sort((a, b) => {
    const na = /\d+$/.exec(a.label);
    const nb = /\d+$/.exec(b.label);
    if (na && nb) return Number(na[0]) - Number(nb[0]);
    if (na) return -1;
    if (nb) return 1;
    return a.xM - b.xM;
  });
}

// Typen, die im Plan vorkommen, für die Legende. No-Shoot wird eigener Eintrag.
export function legendTypes(stage) {
  const seen = new Set();
  const out = [];
  for (const obj of stage.objects) {
    const key = obj.type === "target" && obj.properties.targetVariant === "no-shoot" ? "noShoot" : obj.type;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: key === "noShoot" ? "No-Shoot" : OBJECT_TYPES[obj.type].label });
  }
  const order = ["target", "noShoot", "popper", "steelPlate", "plateRack", "activator", "swinger", "mover", "wall", "window", "door", "backstop", "start", "marker", "arrow", "barrel", "cone", "light", "note"];
  return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function formatM(v) {
  return (Math.round(v * 10) / 10).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
