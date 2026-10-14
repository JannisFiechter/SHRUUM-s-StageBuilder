import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePlanLayout, meterStep, scaleBar, scaleRatio, targetRows, legendTypes } from "./print.js";
import { createObject, createStage, normalizeObject } from "./model.js";

test("Langer Keller: Hochformat mit Plan links und Infospalte", () => {
  const l = choosePlanLayout({ widthM: 10, heightM: 25 });
  assert.equal(l.orientation, "portrait");
  assert.equal(l.layout, "columns");
  assert.ok(l.planMm.h <= l.page.h - l.headerMm - l.footerMm + 1e-6, "Plan passt in die Höhe");
});

test("Breiter Keller: Querformat", () => {
  const l = choosePlanLayout({ widthM: 30, heightM: 12 });
  assert.equal(l.orientation, "landscape");
});

test("Plan überschreitet die Zelle nie", () => {
  for (const [w, h] of [[5, 50], [50, 5], [20, 20], [8, 25], [1, 1]]) {
    for (const o of ["auto", "portrait", "landscape"]) {
      const l = choosePlanLayout({ widthM: w, heightM: h }, o);
      const cellW = l.layout === "columns" ? l.page.w - l.sideColumnMm - l.gapMm : l.page.w;
      const cellH = l.page.h - l.headerMm - l.footerMm - (l.layout === "stacked" ? l.stackedInfoMm + l.gapMm : 0);
      assert.ok(l.planMm.w <= cellW + 1e-6 && l.planMm.h <= cellH + 1e-6, `${w}x${h} ${o}`);
    }
  }
});

test("Meterschritt und Massstab", () => {
  assert.equal(meterStep(9), 1);
  assert.equal(meterStep(4), 2);
  assert.equal(scaleBar(9).meters, 2);
  assert.equal(scaleBar(3).meters, 10);
  assert.equal(scaleRatio(9), 125);
});

test("Zielliste: Nummernreihenfolge, No-Shoot ohne Schuss, Stahl mit Schusszahl", () => {
  const stage = createStage("r", {
    ammo: { roundsPerTarget: 2, runs: 1 },
    objects: [
      createObject("popper", 1, 1),
      createObject("target", 5, 1),
      createObject("noShoot", 3, 1),
      normalizeObject({ ...createObject("target", 2, 1), properties: { targetVariant: "head-only", targetNote: "nur Kopf" } }),
    ],
  });
  const rows = targetRows(stage);
  assert.deepEqual(rows.map((r) => r.label), ["T1", "T2", "", ""]);
  assert.equal(rows[1].detail, "Nur Kopf");
  assert.equal(rows.find((r) => r.noShoot).rounds, 0);
  assert.equal(rows.find((r) => r.type === "Popper").rounds, 1);
  assert.deepEqual(legendTypes(stage).map((l) => l.key), ["target", "noShoot", "popper"]);
});
