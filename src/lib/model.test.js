import { test } from "node:test";
import assert from "node:assert/strict";
import { ammoSummary, createObject, createRange, createStage, normalizeBackstops, normalizeObject, normalizeStage, targetNumbers, toggleBackstop } from "./model.js";
import { buildExport, parseImport, ImportError } from "./io.js";

test("No-Shoot wird als Scheibe mit Variante gespeichert", () => {
  const o = createObject("noShoot", 2, 3);
  assert.equal(o.type, "target");
  assert.equal(o.properties.targetVariant, "no-shoot");
  const legacy = normalizeObject({ type: "noShoot", xM: 1, yM: 1 });
  assert.equal(legacy.type, "target");
});

test("Unbekannte Objekttypen werden verworfen", () => {
  const stage = normalizeStage({ objects: [{ type: "ufo" }, { type: "wall" }] });
  assert.equal(stage.objects.length, 1);
});

test("Munition: Scheiben × Schuss plus Stahl, No-Shoots zählen nicht", () => {
  const range = createRange();
  const stage = createStage(range.id, {
    ammo: { roundsPerTarget: 2, runs: 3 },
    objects: [createObject("target", 1, 1), createObject("target", 2, 1), createObject("noShoot", 3, 1), createObject("popper", 4, 1), createObject("plateRack", 5, 1)],
  });
  const a = ammoSummary(stage);
  assert.equal(a.paperTargets, 2);
  assert.equal(a.steelRounds, 6);
  assert.equal(a.perRun, 10);
  assert.equal(a.total, 30);
});

test("Zielnummern nur für beschiessbare Scheiben", () => {
  const stage = createStage("r", { objects: [createObject("target", 1, 1), createObject("noShoot", 2, 1), createObject("target", 3, 1)] });
  const nums = [...targetNumbers(stage).values()];
  assert.deepEqual(nums, ["T1", "T2"]);
});

test("Kugelfang-Segmente: ausserhalb, doppelt und inaktiv werden entfernt", () => {
  const list = normalizeBackstops(
    [
      { side: "top", meterIndex: 0 },
      { side: "top", meterIndex: 0 },
      { side: "top", meterIndex: 99 },
      { side: "left", meterIndex: 2, active: false },
      { side: "diagonal", meterIndex: 1 },
    ],
    10,
    20,
  );
  assert.deepEqual(list, [{ side: "top", meterIndex: 0, active: true }]);
  const range = createRange({ widthM: 4, heightM: 4 });
  assert.equal(range.boundaryBackstops.length, 4);
  const toggled = toggleBackstop(range, "top", 1);
  assert.equal(toggled.boundaryBackstops.length, 3);
  assert.equal(toggleBackstop(toggled, "top", 1).boundaryBackstops.length, 4);
});

test("Export und Import ergeben dieselben Daten", () => {
  const range = createRange({ name: "Keller A" });
  const stage = createStage(range.id, { name: "S1", objects: [createObject("wall", 2, 2)] });
  const json = JSON.stringify(buildExport({ ranges: [range], stages: [stage] }));
  const result = parseImport(json);
  assert.equal(result.ranges[0].id, range.id);
  assert.equal(result.stages[0].rangeId, range.id);
  assert.deepEqual(result.stages[0].objects, stage.objects);
});

test("Import vergibt neue IDs bei Kollisionen und hält Verknüpfung", () => {
  const range = createRange();
  const stage = createStage(range.id);
  const json = JSON.stringify(buildExport({ ranges: [range], stages: [stage] }));
  const result = parseImport(json, { rangeIds: new Set([range.id]), stageIds: new Set([stage.id]) });
  assert.notEqual(result.ranges[0].id, range.id);
  assert.notEqual(result.stages[0].id, stage.id);
  assert.equal(result.stages[0].rangeId, result.ranges[0].id);
});

test("Altes Exportformat der Flask-Version wird gelesen", () => {
  const legacy = {
    version: 1,
    range: { id: 3, name: "Keller", widthM: 8, heightM: 25, gridM: 1, boundaryBackstops: [{ side: "top", meterIndex: 0, active: true }, { side: "top", meterIndex: 1, active: false }] },
    stage: { id: 7, rangeId: 3, name: "Alt", trainingType: "dynamisch", objects: [{ id: "x", type: "noShoot", xM: 1, yM: 2, widthM: 0.55, heightM: 0.95 }, { type: "light", xM: 2, yM: 2, properties: { color: "#42C96A" } }] },
  };
  const result = parseImport(JSON.stringify(legacy));
  assert.equal(result.legacy, true);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0].boundaryBackstops.length, 1);
  assert.equal(result.stages[0].rangeId, result.ranges[0].id);
  assert.equal(result.stages[0].objects[0].properties.targetVariant, "no-shoot");
  assert.equal(result.stages[0].objects[1].properties.color, "#42C96A");
});

test("Ungültige Dateien werfen verständliche Fehler", () => {
  assert.throws(() => parseImport("{kaputt"), ImportError);
  assert.throws(() => parseImport(JSON.stringify({ foo: 1 })), ImportError);
  assert.throws(() => parseImport(JSON.stringify({ format: "shruum-stagebuilder", schemaVersion: 99, ranges: [], stages: [] })), ImportError);
});

test("Stage ohne passenden Keller wird übersprungen mit Warnung", () => {
  const stage = createStage("fehlt");
  const result = parseImport(JSON.stringify(buildExport({ ranges: [createRange()], stages: [stage] })));
  assert.equal(result.stages.length, 0);
  assert.equal(result.warnings.length, 1);
});
