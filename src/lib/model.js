// Datenmodell des StageBuilders.
// Feldnamen sind bewusst kompatibel zum Export der alten Flask-Version (version 1).

export const SCHEMA_VERSION = 2;

export const SIDES = ["top", "right", "bottom", "left"];

export const OBJECT_TYPES = {
  wall: { label: "Wand", group: "structure", widthM: 2.0, heightM: 0.2, fill: "#475569", stroke: "#0f172a", resizable: "width" },
  window: { label: "Fenster", group: "structure", widthM: 2.0, heightM: 0.2, fill: "#475569", stroke: "#0f172a", accent: "#bfdbfe", resizable: "width" },
  door: { label: "Tür", group: "structure", widthM: 2.0, heightM: 0.2, fill: "#475569", stroke: "#0f172a", resizable: "width" },
  backstop: { label: "Mobiler Kugelfang", group: "structure", widthM: 1.4, heightM: 0.55, fill: "#991b1b", stroke: "#1f0a0a", accent: "#fecaca", resizable: "width" },
  target: { label: "Scheibe", group: "targets", widthM: 0.55, heightM: 0.3, fill: "#d9a441", stroke: "#1c1917", shootable: true },
  noShoot: { label: "No-Shoot", group: "targets", widthM: 0.55, heightM: 0.3, fill: "#f8fafc", stroke: "#dc2626", alias: "target" },
  popper: { label: "Popper", group: "targets", widthM: 0.45, heightM: 0.45, fill: "#cbd5e1", stroke: "#0f172a", steelRounds: 1 },
  steelPlate: { label: "Stahlplatte", group: "targets", widthM: 0.35, heightM: 0.35, fill: "#e2e8f0", stroke: "#0f172a", steelRounds: 1 },
  plateRack: { label: "Plate Rack", group: "targets", widthM: 1.5, heightM: 0.4, fill: "#cbd5e1", stroke: "#0f172a", steelRounds: 5 },
  activator: { label: "Aktivator", group: "targets", widthM: 0.45, heightM: 0.45, fill: "#86efac", stroke: "#0f172a" },
  start: { label: "Startposition", group: "markers", widthM: 0.75, heightM: 0.75, fill: "#22d3ee", stroke: "#083344", accent: "#ecfeff" },
  marker: { label: "Position", group: "markers", widthM: 0.5, heightM: 0.5, fill: "#c084fc", stroke: "#2e1065" },
  arrow: { label: "Laufweg", group: "markers", widthM: 1.0, heightM: 0.35, fill: "#22c55e", stroke: "#052e16", resizable: "width" },
  note: { label: "Notiz", group: "markers", widthM: 1.6, heightM: 0.6, fill: "#fef3c7", stroke: "#78350f", resizable: "both" },
  barrel: { label: "Fass", group: "props", widthM: 0.6, heightM: 0.6, fill: "#3b82f6", stroke: "#0f172a" },
  cone: { label: "Pylone", group: "props", widthM: 0.35, heightM: 0.35, fill: "#f97316", stroke: "#431407" },
  light: { label: "Licht", group: "props", widthM: 0.4, heightM: 0.4, fill: "#fde68a", stroke: "#0f172a" },
  swinger: { label: "Swinger", group: "hidden", widthM: 0.6, heightM: 0.5, fill: "#fde68a", stroke: "#0f172a", shootable: true },
  mover: { label: "Mover", group: "hidden", widthM: 0.6, heightM: 0.5, fill: "#93c5fd", stroke: "#0f172a", shootable: true },
};

export const PALETTE_GROUPS = [
  { id: "structure", label: "Bauten" },
  { id: "targets", label: "Ziele" },
  { id: "markers", label: "Markierungen" },
  { id: "props", label: "Material" },
];

export const RENDER_ORDER = {
  wall: 10, window: 11, door: 12, backstop: 20,
  barrel: 40, cone: 40, light: 40, note: 30, arrow: 35, marker: 45, start: 45,
  popper: 68, steelPlate: 68, plateRack: 68, activator: 68, swinger: 68, mover: 68,
  target: 70,
};

export const TARGET_VARIANTS = [
  { value: "full", label: "Voll" },
  { value: "no-shoot", label: "No-Shoot" },
  { value: "half", label: "Halb abgedeckt" },
  { value: "head-only", label: "Nur Kopf" },
];

export const VARIANT_DIRECTIONS = [
  { value: "left", label: "Links frei" },
  { value: "right", label: "Rechts frei" },
  { value: "top", label: "Oben frei" },
  { value: "bottom", label: "Unten frei" },
];

export const TRAINING_TYPES = [
  { value: "statisch", label: "Statisch" },
  { value: "dynamisch", label: "Dynamisch" },
  { value: "kombiniert", label: "Kombiniert" },
];

export const WEAPON_TYPES = [
  { value: "kurzwaffe", label: "Kurzwaffe" },
  { value: "langwaffe", label: "Langwaffe" },
  { value: "kurzwaffe_langwaffe", label: "Kurz- und Langwaffe" },
];

export const START_POSITIONS_HANDGUN = ["Holster", "Low Ready", "High Ready", "Tisch", "Hände über Schultern"];
export const START_POSITIONS_LONGGUN = ["Low Ready", "High Ready", "Tisch", "Fass", "Schulter"];

export const FOCUS_AREAS = [
  "Präzision", "Speed", "Draw / Ready", "Reloads", "Störungen", "Zielwechsel",
  "Bewegung", "Deckung / Wand", "Entscheidung / No-Shoot", "Licht / Reaktion",
  "Einhand", "Langwaffe", "Waffenwechsel", "Team", "Standard / Test",
];

export const TARGET_TYPES = ["IPSC Target", "IDPA Target", "CMA Target", "Manscheibe", "Belgische Zielscheibe", "Target"];

const STRUCTURE = new Set(["wall", "window", "door"]);
const TARGET_LIKE = new Set(["target", "swinger", "mover"]);

export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
const str = (value) => (value == null ? "" : String(value));

export function createRange(partial = {}) {
  const now = nowIso();
  return normalizeRange({
    id: uid(),
    name: "Neuer Schiesskeller",
    widthM: 10,
    heightM: 25,
    gridM: 1,
    boundaryBackstops: defaultBackstops(partial.widthM ?? 10),
    notes: "",
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

function defaultBackstops(widthM) {
  return Array.from({ length: Math.round(widthM) }, (_, meterIndex) => ({ side: "top", meterIndex, active: true }));
}

export function sideLength(range, side) {
  return Math.round(side === "top" || side === "bottom" ? range.widthM : range.heightM);
}

export function normalizeBackstops(items, widthM, heightM) {
  const limits = { top: Math.round(widthM), bottom: Math.round(widthM), left: Math.round(heightM), right: Math.round(heightM) };
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const side = item && item.side;
    const meterIndex = Math.trunc(num(item && item.meterIndex, -1));
    if (!SIDES.includes(side) || meterIndex < 0 || meterIndex >= limits[side]) continue;
    const key = `${side}:${meterIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.active === false) continue;
    result.push({ side, meterIndex, active: true });
  }
  return result.sort((a, b) => SIDES.indexOf(a.side) - SIDES.indexOf(b.side) || a.meterIndex - b.meterIndex);
}

export function normalizeRange(raw = {}) {
  const widthM = clamp(num(raw.widthM, 10), 1, 200);
  const heightM = clamp(num(raw.heightM, 25), 1, 400);
  return {
    id: str(raw.id) || uid(),
    name: str(raw.name) || "Schiesskeller",
    widthM,
    heightM,
    gridM: oneOf(num(raw.gridM, 1), [0.25, 0.5, 1, 2, 5], 1),
    boundaryBackstops: normalizeBackstops(raw.boundaryBackstops, widthM, heightM),
    notes: str(raw.notes),
    createdAt: str(raw.createdAt) || nowIso(),
    updatedAt: str(raw.updatedAt) || nowIso(),
  };
}

export function toggleBackstop(range, side, meterIndex) {
  const exists = range.boundaryBackstops.some((b) => b.side === side && b.meterIndex === meterIndex);
  const next = exists
    ? range.boundaryBackstops.filter((b) => !(b.side === side && b.meterIndex === meterIndex))
    : [...range.boundaryBackstops, { side, meterIndex, active: true }];
  return { ...range, boundaryBackstops: normalizeBackstops(next, range.widthM, range.heightM) };
}

export function createStage(rangeId, partial = {}) {
  const now = nowIso();
  return normalizeStage({ id: uid(), rangeId, name: "Neue Stage", createdAt: now, updatedAt: now, ...partial });
}

export function normalizeStage(raw = {}) {
  const ammo = raw.ammo || {};
  const numbering = raw.targetNumbering || {};
  return {
    id: str(raw.id) || uid(),
    rangeId: str(raw.rangeId),
    name: str(raw.name) || "Stage",
    version: str(raw.version) || "v1.0",
    description: str(raw.description),
    trainingGoal: str(raw.trainingGoal),
    procedure: str(raw.procedure),
    safetyNotes: str(raw.safetyNotes),
    trainingType: oneOf(raw.trainingType, TRAINING_TYPES.map((t) => t.value), "statisch"),
    weaponType: oneOf(raw.weaponType, WEAPON_TYPES.map((t) => t.value), "kurzwaffe"),
    startPositionHandgun: str(raw.startPositionHandgun) || "Holster",
    startPositionLongGun: str(raw.startPositionLongGun) || "Low Ready",
    focusAreas: (Array.isArray(raw.focusAreas) ? raw.focusAreas : []).filter((f) => FOCUS_AREAS.includes(f)),
    targetType: str(raw.targetType) || "IPSC Target",
    targetNumbering: { enabled: numbering.enabled !== false, prefix: str(numbering.prefix ?? "T") || "T", start: Math.max(0, Math.trunc(num(numbering.start, 1))) },
    ammo: { roundsPerTarget: clamp(Math.trunc(num(ammo.roundsPerTarget, 2)), 1, 20), runs: clamp(Math.trunc(num(ammo.runs, 1)), 1, 100) },
    objects: normalizeObjects(raw.objects),
    createdAt: str(raw.createdAt) || nowIso(),
    updatedAt: str(raw.updatedAt) || nowIso(),
  };
}

export function normalizeObjects(objects) {
  return (Array.isArray(objects) ? objects : []).map(normalizeObject).filter(Boolean);
}

export function normalizeObject(raw) {
  if (!raw || typeof raw !== "object") return null;
  let type = raw.type;
  let properties = raw.properties && typeof raw.properties === "object" ? { ...raw.properties } : {};
  if (type === "noShoot") {
    type = "target";
    properties.targetVariant = "no-shoot";
  }
  if (type === "barricade" || type === "wallWindow") type = "window";
  if (!OBJECT_TYPES[type]) return null;
  const spec = OBJECT_TYPES[type];
  const widthM = clamp(num(raw.widthM, spec.widthM), 0.05, 100);
  const heightM = clamp(num(raw.heightM, spec.heightM), 0.05, 100);
  if (TARGET_LIKE.has(type)) {
    properties = {
      targetVariant: oneOf(properties.targetVariant, TARGET_VARIANTS.map((v) => v.value), "full"),
      variantDirection: oneOf(properties.variantDirection, VARIANT_DIRECTIONS.map((v) => v.value), "right"),
      targetNote: str(properties.targetNote),
    };
  } else if (type === "window") {
    properties = normalizeOpening(properties, widthM, "openingWidthM", "openingPosition", 1.0);
  } else if (type === "door") {
    properties = {
      ...normalizeOpening(properties, widthM, "doorWidthM", "doorPosition", 0.9),
      hingeSide: oneOf(properties.hingeSide, ["left", "right"], "left"),
      swingDirection: oneOf(properties.swingDirection, ["in", "out"], "in"),
      openAngle: oneOf(num(properties.openAngle, 90), [45, 90, 120], 90),
    };
  } else if (type === "note") {
    properties = { text: str(properties.text) };
  } else if (type !== "light") {
    properties = {};
  }
  return {
    id: str(raw.id) || uid(),
    type,
    xM: num(raw.xM, 0),
    yM: num(raw.yM, 0),
    widthM,
    heightM,
    rotation: normalizeAngle(num(raw.rotation, 0)),
    label: str(raw.label),
    locked: Boolean(raw.locked),
    properties,
  };
}

function normalizeOpening(props, lengthM, widthKey, positionKey, fallbackWidth) {
  const openWidth = clamp(num(props[widthKey], Math.min(fallbackWidth, lengthM * 0.6)), 0.1, Math.max(0.1, lengthM - 0.1));
  const position = oneOf(props[positionKey], ["left", "center", "right", "custom"], "center");
  const maxOffset = Math.max(0, lengthM - openWidth);
  return { [widthKey]: openWidth, [positionKey]: position, openingOffsetM: clamp(num(props.openingOffsetM, maxOffset / 2), 0, maxOffset) };
}

export function normalizeAngle(deg) {
  const value = ((deg % 360) + 360) % 360;
  return Math.round(value * 100) / 100;
}

export function createObject(type, centerX, centerY) {
  const isNoShoot = type === "noShoot";
  const realType = isNoShoot ? "target" : type;
  const spec = OBJECT_TYPES[realType];
  return normalizeObject({
    id: uid(),
    type: realType,
    xM: centerX - spec.widthM / 2,
    yM: centerY - spec.heightM / 2,
    widthM: spec.widthM,
    heightM: spec.heightM,
    properties: isNoShoot ? { targetVariant: "no-shoot" } : {},
  });
}

export function isStructure(type) {
  return STRUCTURE.has(type);
}

export function isShootableTarget(obj) {
  return TARGET_LIKE.has(obj.type) && (obj.properties || {}).targetVariant !== "no-shoot";
}

// Automatische Nummerierung der beschiessbaren Papierziele in Erstellungsreihenfolge.
export function targetNumbers(stage) {
  const map = new Map();
  if (!stage.targetNumbering.enabled) return map;
  let n = stage.targetNumbering.start;
  for (const obj of stage.objects) {
    if (isShootableTarget(obj)) map.set(obj.id, `${stage.targetNumbering.prefix}${n++}`);
  }
  return map;
}

export function ammoSummary(stage) {
  let paperTargets = 0;
  let steelRounds = 0;
  let noShoots = 0;
  for (const obj of stage.objects) {
    if (isShootableTarget(obj)) paperTargets += 1;
    else if (TARGET_LIKE.has(obj.type)) noShoots += 1;
    steelRounds += OBJECT_TYPES[obj.type]?.steelRounds || 0;
  }
  const perRun = paperTargets * stage.ammo.roundsPerTarget + steelRounds;
  return { paperTargets, steelRounds, noShoots, perRun, total: perRun * stage.ammo.runs };
}

export function materialList(stage) {
  const counts = new Map();
  for (const obj of stage.objects) {
    let label = OBJECT_TYPES[obj.type].label;
    if (obj.type === "target" && obj.properties.targetVariant === "no-shoot") label = "No-Shoot";
    if (obj.type === "start" || obj.type === "arrow" || obj.type === "note" || obj.type === "marker") continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}
