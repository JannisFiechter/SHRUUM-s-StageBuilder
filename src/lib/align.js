// Ausrichten und Verteilen mehrerer Objekte anhand ihrer achsparallelen Hülle.
import { bounds, unionBounds } from "./geometry.js";

const shift = (obj, dx, dy) => ({ ...obj, xM: obj.xM + dx, yM: obj.yM + dy });

export function alignObjects(objects, mode) {
  const movable = objects.filter((o) => !o.locked);
  if (movable.length < 2) return objects;
  const all = unionBounds(movable);
  const ids = new Set(movable.map((o) => o.id));
  return objects.map((o) => {
    if (!ids.has(o.id)) return o;
    const b = bounds(o);
    switch (mode) {
      case "left": return shift(o, all.minX - b.minX, 0);
      case "right": return shift(o, all.maxX - b.maxX, 0);
      case "hcenter": return shift(o, (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
      case "top": return shift(o, 0, all.minY - b.minY);
      case "bottom": return shift(o, 0, all.maxY - b.maxY);
      case "vcenter": return shift(o, 0, (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2);
      default: return o;
    }
  });
}

// Verteilt die Mittelpunkte gleichmässig zwischen dem ersten und letzten Objekt.
export function distributeObjects(objects, axis) {
  const movable = objects.filter((o) => !o.locked);
  if (movable.length < 3) return objects;
  const key = axis === "x" ? "cx" : "cy";
  const sorted = movable.map((o) => ({ o, b: bounds(o) })).sort((a, b) => a.b[key] - b.b[key]);
  const first = sorted[0].b[key];
  const last = sorted[sorted.length - 1].b[key];
  const step = (last - first) / (sorted.length - 1);
  const target = new Map(sorted.map((item, i) => [item.o.id, first + step * i - item.b[key]]));
  return objects.map((o) => {
    if (!target.has(o.id)) return o;
    const d = target.get(o.id);
    return axis === "x" ? shift(o, d, 0) : shift(o, 0, d);
  });
}
