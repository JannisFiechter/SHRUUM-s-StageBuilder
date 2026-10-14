// Reine Geometrie in Metern. Wird vom Editor-Renderer und von den Tests genutzt.

export function openingStart(lengthM, openingWidthM, position, offsetM) {
  const max = Math.max(0, lengthM - openingWidthM);
  if (position === "left") return 0;
  if (position === "right") return max;
  if (position === "custom") return Math.min(max, Math.max(0, Number(offsetM) || 0));
  return max / 2;
}

export function openingSegments(lengthM, openingWidthM, position, offsetM) {
  const start = openingStart(lengthM, openingWidthM, position, offsetM);
  const end = Math.min(lengthM, start + openingWidthM);
  return { leftM: start, openingStartM: start, openingEndM: end, rightStartM: end, rightM: Math.max(0, lengthM - end) };
}

export function center(obj) {
  return { x: obj.xM + obj.widthM / 2, y: obj.yM + obj.heightM / 2 };
}

export function rotatePoint(p, c, deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function corners(obj) {
  const c = center(obj);
  const pts = [
    { x: obj.xM, y: obj.yM },
    { x: obj.xM + obj.widthM, y: obj.yM },
    { x: obj.xM + obj.widthM, y: obj.yM + obj.heightM },
    { x: obj.xM, y: obj.yM + obj.heightM },
  ];
  return obj.rotation ? pts.map((p) => rotatePoint(p, c, obj.rotation)) : pts;
}

// Achsparallele Hülle eines (gedrehten) Objekts.
export function bounds(obj) {
  const pts = corners(obj);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function unionBounds(objects) {
  if (!objects.length) return null;
  return objects.map(bounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function rectsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function normalizeRect(x1, y1, x2, y2) {
  return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

// Fangen beim Verschieben: Kanten und Mitten der bewegten Gruppe richten sich
// an anderen Objekten und am Raster aus. Liefert korrigierte Verschiebung plus Hilfslinien.
export function snapDelta(movingBounds, dx, dy, otherBounds, gridM, thresholdM) {
  const moved = {
    xs: [movingBounds.minX + dx, (movingBounds.minX + movingBounds.maxX) / 2 + dx, movingBounds.maxX + dx],
    ys: [movingBounds.minY + dy, (movingBounds.minY + movingBounds.maxY) / 2 + dy, movingBounds.maxY + dy],
  };
  const targetsX = [];
  const targetsY = [];
  for (const b of otherBounds) {
    targetsX.push(b.minX, (b.minX + b.maxX) / 2, b.maxX);
    targetsY.push(b.minY, (b.minY + b.maxY) / 2, b.maxY);
  }
  const best = (values, targets, gridStep) => {
    let bestOffset = null;
    let bestLine = null;
    let bestDist = thresholdM;
    for (const v of values) {
      for (const t of targets) {
        const d = Math.abs(t - v);
        if (d < bestDist) {
          bestDist = d;
          bestOffset = t - v;
          bestLine = t;
        }
      }
    }
    if (bestOffset !== null) return { offset: bestOffset, line: bestLine };
    if (gridStep > 0) {
      // Rasterfang über die linke bzw. obere Kante, nur wenn kein Objektfang greift.
      const v = values[0];
      const snapped = Math.round(v / gridStep) * gridStep;
      if (Math.abs(snapped - v) < thresholdM) return { offset: snapped - v, line: null };
    }
    return { offset: 0, line: null };
  };
  const sx = best(moved.xs, targetsX, gridM);
  const sy = best(moved.ys, targetsY, gridM);
  return { dx: dx + sx.offset, dy: dy + sy.offset, guideX: sx.line, guideY: sy.line };
}

export function snapAngle(deg, step = 15) {
  return Math.round(deg / step) * step;
}

// Hält den Mittelpunkt eines Objekts innerhalb des Schiesskellers.
export function clampCenterToRange(obj, range) {
  const c = center(obj);
  const cx = Math.min(range.widthM, Math.max(0, c.x));
  const cy = Math.min(range.heightM, Math.max(0, c.y));
  return { ...obj, xM: obj.xM + (cx - c.x), yM: obj.yM + (cy - c.y) };
}

export function round(value, step = 0.01) {
  return Math.round(value / step) * step;
}
