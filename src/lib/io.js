// JSON-Export und -Import. Liest das eigene Format (schemaVersion 2)
// und Einzel-Exporte der alten Flask-Version ({ version: 1, stage, range }).

import { SCHEMA_VERSION, normalizeRange, normalizeStage, uid, nowIso } from "./model.js";

const FORMAT = "shruum-stagebuilder";

export function buildExport({ ranges, stages }) {
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    ranges,
    stages,
  };
}

export function exportFileName(label) {
  const slug = String(label || "export")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "export";
  return `${slug}.stagebuilder.json`;
}

export class ImportError extends Error {}

// Liefert normalisierte Ranges und Stages. Kollidierende IDs werden neu vergeben,
// damit ein Import nie bestehende Daten überschreibt.
export function parseImport(input, existing = { rangeIds: new Set(), stageIds: new Set() }) {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch {
      throw new ImportError("Die Datei ist kein gültiges JSON.");
    }
  }
  if (!payload || typeof payload !== "object") throw new ImportError("Unbekanntes Dateiformat.");

  let rawRanges;
  let rawStages;
  let legacy = false;
  if (payload.format === FORMAT) {
    if (Number(payload.schemaVersion) > SCHEMA_VERSION) {
      throw new ImportError("Die Datei stammt aus einer neueren Version des StageBuilders.");
    }
    rawRanges = Array.isArray(payload.ranges) ? payload.ranges : [];
    rawStages = Array.isArray(payload.stages) ? payload.stages : [];
  } else if (payload.stage && typeof payload.stage === "object") {
    legacy = true;
    rawRanges = payload.range ? [payload.range] : [];
    rawStages = [payload.stage];
  } else {
    throw new ImportError("Unbekanntes Dateiformat. Erwartet wird ein StageBuilder-Export.");
  }
  if (!rawStages.length && !rawRanges.length) throw new ImportError("Die Datei enthält keine Stages oder Schiesskeller.");

  const rangeIdMap = new Map();
  const usedRangeIds = new Set(existing.rangeIds);
  const ranges = rawRanges.map((raw) => {
    const originalId = String(raw.id ?? "");
    const range = normalizeRange({ ...raw, id: undefined });
    range.id = originalId && !usedRangeIds.has(originalId) && !legacy ? originalId : uid();
    if (legacy) range.name = `${range.name} (Import)`;
    usedRangeIds.add(range.id);
    rangeIdMap.set(originalId, range.id);
    return range;
  });

  const warnings = [];
  const usedStageIds = new Set(existing.stageIds);
  const knownRangeIds = new Set([...existing.rangeIds, ...ranges.map((r) => r.id)]);
  const stages = [];
  for (const raw of rawStages) {
    const originalRangeId = String(raw.rangeId ?? "");
    let rangeId = rangeIdMap.get(originalRangeId);
    if (!rangeId && legacy && ranges.length === 1) rangeId = ranges[0].id;
    if (!rangeId && knownRangeIds.has(originalRangeId)) rangeId = originalRangeId;
    if (!rangeId) {
      warnings.push(`Stage «${raw.name || "ohne Namen"}» übersprungen: Schiesskeller fehlt.`);
      continue;
    }
    const originalId = String(raw.id ?? "");
    const stage = normalizeStage({ ...raw, rangeId });
    stage.id = originalId && !usedStageIds.has(originalId) && !legacy ? originalId : uid();
    usedStageIds.add(stage.id);
    stages.push(stage);
  }
  return { ranges, stages, warnings, legacy };
}

export function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
