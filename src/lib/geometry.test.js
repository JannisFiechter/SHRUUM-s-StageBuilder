import { test } from "node:test";
import assert from "node:assert/strict";
import { bounds, clampCenterToRange, corners, openingSegments, snapAngle, snapDelta } from "./geometry.js";
import { alignObjects, distributeObjects } from "./align.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const box = (id, x, y, w = 1, h = 1, rotation = 0, locked = false) => ({ id, xM: x, yM: y, widthM: w, heightM: h, rotation, locked });

test("Öffnung mittig, links, rechts und frei", () => {
  close(openingSegments(4, 1, "center").openingStartM, 1.5);
  close(openingSegments(4, 1, "left").openingStartM, 0);
  close(openingSegments(4, 1, "right").openingStartM, 3);
  const custom = openingSegments(4, 1, "custom", 0.5);
  close(custom.openingStartM, 0.5);
  close(custom.rightM, 2.5);
  // Offset wird auf die Wandlänge begrenzt
  close(openingSegments(4, 1, "custom", 9).openingStartM, 3);
});

test("Hülle eines um 90° gedrehten Objekts", () => {
  const b = bounds(box("a", 0, 0, 4, 1, 90));
  close(b.minX, 1.5);
  close(b.maxX, 2.5);
  close(b.minY, -1.5);
  close(b.maxY, 2.5);
  assert.equal(corners(box("a", 0, 0, 2, 1)).length, 4);
});

test("Fangen richtet an Kante eines anderen Objekts aus", () => {
  const moving = bounds(box("m", 0, 0, 1, 1));
  const other = bounds(box("o", 3, 5, 1, 1));
  // Bewegung um 2.95 m: rechte Kante (3.95) sollte an linke Kante 3 oder Mitte 3.5 … nächste ist 4 (rechte Kante)
  const r = snapDelta(moving, 2.95, 0.3, [other], 0, 0.1);
  close(r.dx, 3);
  assert.equal(r.guideX, 3);
});

test("Rasterfang greift nur ohne Objektfang", () => {
  const moving = bounds(box("m", 0, 0, 1, 1));
  const r = snapDelta(moving, 1.96, 0.04, [], 1, 0.1);
  close(r.dx, 2);
  close(r.dy, 0);
  assert.equal(r.guideX, null);
});

test("Winkel auf 15° runden", () => {
  assert.equal(snapAngle(52), 45);
  assert.equal(snapAngle(53), 60);
});

test("Mittelpunkt bleibt im Keller", () => {
  const range = { widthM: 10, heightM: 20 };
  const o = clampCenterToRange(box("a", 12, -3, 2, 2), range);
  close(o.xM + 1, 10);
  close(o.yM + 1, 0);
});

test("Ausrichten links und gesperrte Objekte bleiben stehen", () => {
  const objs = [box("a", 1, 0), box("b", 4, 2), box("c", 7, 3, 1, 1, 0, true)];
  const out = alignObjects(objs, "left");
  close(out[0].xM, 1);
  close(out[1].xM, 1);
  close(out[2].xM, 7);
});

test("Verteilen setzt gleiche Mittelpunktsabstände", () => {
  const objs = [box("a", 0, 0), box("b", 1, 0), box("c", 10, 0)];
  const out = distributeObjects(objs, "x");
  close(out[1].xM, 5);
});
