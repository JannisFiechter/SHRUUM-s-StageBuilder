const focusAreas = [
  "Präzision", "Speed", "Draw / Ready", "Reloads", "Störungen", "Zielwechsel",
  "Bewegung", "Deckung / Barrikade", "Entscheidung / No-Shoot", "Licht / Reaktion",
  "Einhand", "Langwaffe", "Waffenwechsel", "Team", "Standard / Test"
];

const symbolContract = window.SYMBOL_CONTRACT;
const objectTypes = Object.fromEntries(Object.entries(symbolContract.objects).map(([key, spec]) => [
  key,
  { label: spec.label, widthM: spec.widthM, heightM: spec.heightM }
]));
const symbolTheme = Object.fromEntries(Object.entries(symbolContract.objects).map(([key, spec]) => [
  key,
  { fill: spec.fill, stroke: spec.stroke, accent: spec.accent }
]));

const $ = (id) => document.getElementById(id);
const ns = "http://www.w3.org/2000/svg";

let ranges = [];
let stages = [];
let activeRange = null;
let editingRange = null;
let appSettings = { authorName: "", customFooterText: "", defaultVersion: "v1.0" };
let currentStage = blankStage();
let selectedObjectId = null;
let dragState = null;
let stageDirty = false;

const renderOrder = {
  wall: 10,
  backstop: 20,
  barricade: 30,
  barrel: 40,
  cone: 40,
  light: 40,
  note: 40,
  arrow: 40,
  marker: 40,
  start: 45,
  target: 70,
  noShoot: 80
};

function blankStage(rangeId = null) {
  return {
    id: null,
    rangeId,
    name: "Neue Stage",
    version: "v1.0",
    description: "",
    trainingGoal: "",
    procedure: "",
    safetyNotes: "",
    trainingType: "statisch",
    weaponType: "kurzwaffe",
    startPositionHandgun: "Holster",
    startPositionLongGun: "Low Ready",
    focusAreas: [],
    difficultyCalculated: "Leicht",
    difficultyManual: "",
    difficultyOverrideEnabled: false,
    difficultyReasons: [],
    ammo: { autoCalculate: true, targetCount: 0, roundsPerTarget: 2, roundsPerRun: 0, runs: 1, roundsPerShooterTotal: 0, manualAmmoNote: "" },
    magPrep: {
      handgun: { magazineCount: 3, magazines: defaultMags(3) },
      longGun: { magazineCount: 3, magazines: defaultMags(3) }
    },
    objects: []
  };
}

function defaultMags(count) {
  return Array.from({ length: count }, (_, i) => ({ name: `Magazin ${i + 1}`, state: "voll", rounds: null }));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    let message = "Fehler";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}

function setStatus(text, isError = false) {
  $("statusText").textContent = text;
  $("statusText").style.color = isError ? "#fca5a5" : "";
  if (isError) setSaveState("error", "Fehler beim Speichern");
}

function setSaveState(state, label) {
  const badge = $("saveStateBadge");
  if (!badge) return;
  badge.className = `status-badge ${state}`;
  badge.textContent = label;
}

function updateTopbarMeta() {
  if ($("topbarVersion")) $("topbarVersion").textContent = currentStage && currentStage.version ? currentStage.version : "v1.0";
  if ($("topbarRange")) {
    const rangeName = activeRange && activeRange.name ? activeRange.name : "";
    $("topbarRange").hidden = !rangeName;
    $("topbarRange").textContent = rangeName;
  }
}

function markDirty() {
  stageDirty = true;
  setSaveState("dirty", "Ungespeicherte Änderungen");
}

async function init() {
  buildFocusGrid();
  bindEvents();
  await loadSettings();
  await loadRanges();
  await loadStages();
  activeRange = ranges[0] || null;
  currentStage = blankStage(activeRange ? activeRange.id : null);
  currentStage.version = "v1.0";
  syncStageToForm();
  renderRangeSelect();
  renderStage();
  updateTopbarMeta();
  setSaveState("saved", "Gespeichert");
  setStatus(activeRange ? "Bereit" : "Bitte zuerst einen Schiesskeller erstellen");
}

function bindEvents() {
  $("newStageBtn").addEventListener("click", newStage);
  $("saveStageBtn").addEventListener("click", saveStage);
  $("loadStageBtn").addEventListener("click", openLoadDialog);
  $("duplicateStageBtn").addEventListener("click", duplicateStage);
  $("pdfBtn").addEventListener("click", exportPdf);
  $("jsonExportBtn").addEventListener("click", exportJson);
  $("jsonImportBtn").addEventListener("click", () => $("jsonFile").click());
  $("jsonFile").addEventListener("change", importJson);
  $("settingsBtn").addEventListener("click", openSettingsDialog);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
  $("rangesBtn").addEventListener("click", openRangeDialog);
  $("rangeSelect").addEventListener("change", () => {
    activeRange = ranges.find(r => String(r.id) === $("rangeSelect").value) || activeRange;
    currentStage.rangeId = activeRange.id;
    calculateDifficulty();
    renderStage();
    updateTopbarMeta();
    markDirty();
  });
  document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
  document.querySelectorAll("[data-add]").forEach(btn => btn.addEventListener("click", () => addObject(btn.dataset.add)));
  $("rotateLeftBtn").addEventListener("click", () => rotateSelectedObject(-15));
  $("rotateRightBtn").addEventListener("click", () => rotateSelectedObject(15));
  $("duplicateObjectBtn").addEventListener("click", duplicateSelectedObject);
  $("deleteObjectBtn").addEventListener("click", deleteSelectedObject);
  document.addEventListener("keydown", handleShortcuts);
  ["stageName", "stageVersion", "description", "trainingGoal", "procedure", "safetyNotes", "trainingType", "weaponType",
    "startPositionHandgun", "startPositionLongGun", "difficultyManual", "manualAmmoNote"].forEach(id => {
    $(id).addEventListener("input", readStageFromForm);
  });
  ["ammoAutoCalculate", "roundsPerTarget", "roundsPerRun", "runs"].forEach(id => $(id).addEventListener("input", () => { readStageFromForm(); renderAmmoFields(); }));
  $("ammoAutoCalculate").addEventListener("change", () => { readStageFromForm(); renderAmmoFields(); });
  $("difficultyOverrideEnabled").addEventListener("change", readStageFromForm);
  $("handgunMagCount").addEventListener("input", () => resizeMags("handgun", Number($("handgunMagCount").value || 0)));
  $("longGunMagCount").addEventListener("input", () => resizeMags("longGun", Number($("longGunMagCount").value || 0)));
  $("newRangeBtn").addEventListener("click", newEditingRange);
  $("saveRangeBtn").addEventListener("click", saveRange);
  $("deleteRangeBtn").addEventListener("click", deleteRange);
  ["rangeName", "rangeDescription", "rangeWidth", "rangeHeight", "rangeGrid", "rangePpm", "rangeNotes"].forEach(id => {
    $(id).addEventListener("input", () => { readEditingRange(); renderBoundaryEditor(); });
  });
}

function activateTab(tab) {
  document.querySelectorAll("[data-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll("[data-tab-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.tabPanel === tab));
}

async function loadRanges() {
  ranges = await api("/api/ranges");
}

async function loadStages() {
  stages = await api("/api/stages");
}

async function loadSettings() {
  appSettings = await api("/api/settings");
}

function renderRangeSelect() {
  $("rangeSelect").innerHTML = ranges.length
    ? ranges.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${r.widthM} x ${r.heightM} m)</option>`).join("")
    : `<option value="">Kein Schiesskeller vorhanden</option>`;
  $("rangeSelect").disabled = !ranges.length;
  if (activeRange) $("rangeSelect").value = String(activeRange.id);
}

function buildFocusGrid() {
  $("focusGrid").innerHTML = focusAreas.map(item => `
    <label class="check-row"><input type="checkbox" value="${escapeHtml(item)}"> ${escapeHtml(item)}</label>
  `).join("");
  $("focusGrid").querySelectorAll("input").forEach(input => input.addEventListener("change", readStageFromForm));
}

function syncStageToForm() {
  $("stageName").value = currentStage.name || "";
  $("stageVersion").value = currentStage.version || appSettings.defaultVersion || "v1.0";
  $("description").value = currentStage.description || "";
  $("trainingGoal").value = currentStage.trainingGoal || "";
  $("procedure").value = currentStage.procedure || "";
  $("safetyNotes").value = currentStage.safetyNotes || "";
  $("trainingType").value = currentStage.trainingType;
  $("weaponType").value = currentStage.weaponType;
  $("startPositionHandgun").value = currentStage.startPositionHandgun || "Holster";
  $("startPositionLongGun").value = currentStage.startPositionLongGun || "Low Ready";
  $("difficultyOverrideEnabled").checked = !!currentStage.difficultyOverrideEnabled;
  $("difficultyManual").value = currentStage.difficultyManual || "";
  normalizeAmmoState();
  $("ammoAutoCalculate").checked = !!currentStage.ammo.autoCalculate;
  $("targetCount").value = currentStage.ammo.targetCount || 0;
  $("roundsPerTarget").value = currentStage.ammo.roundsPerTarget || 2;
  $("roundsPerRun").value = currentStage.ammo.roundsPerRun || 0;
  $("runs").value = currentStage.ammo.runs || 1;
  $("manualAmmoNote").value = currentStage.ammo.manualAmmoNote || "";
  $("focusGrid").querySelectorAll("input").forEach(input => input.checked = currentStage.focusAreas.includes(input.value));
  $("handgunMagCount").value = currentStage.magPrep.handgun.magazineCount;
  $("longGunMagCount").value = currentStage.magPrep.longGun.magazineCount;
  renderWeaponDependent();
  renderAmmoFields();
  renderMags("handgun");
  renderMags("longGun");
  calculateDifficulty();
  renderObjectForm();
  updateTopbarMeta();
}

function readStageFromForm() {
  currentStage.name = $("stageName").value;
  currentStage.version = $("stageVersion").value || "v1.0";
  currentStage.description = $("description").value;
  currentStage.trainingGoal = $("trainingGoal").value;
  currentStage.procedure = $("procedure").value;
  currentStage.safetyNotes = $("safetyNotes").value;
  currentStage.trainingType = $("trainingType").value;
  currentStage.weaponType = $("weaponType").value;
  currentStage.startPositionHandgun = $("startPositionHandgun").value;
  currentStage.startPositionLongGun = $("startPositionLongGun").value;
  currentStage.focusAreas = [...$("focusGrid").querySelectorAll("input:checked")].map(i => i.value);
  currentStage.difficultyOverrideEnabled = $("difficultyOverrideEnabled").checked;
  currentStage.difficultyManual = $("difficultyManual").value;
  const autoCalculate = $("ammoAutoCalculate").checked;
  const targetCount = countTargets();
  const roundsPerTarget = Math.max(1, Number($("roundsPerTarget").value || 2));
  const rounds = autoCalculate ? targetCount * roundsPerTarget : Math.max(0, Number($("roundsPerRun").value || 0));
  const runs = Math.max(1, Number($("runs").value || 1));
  currentStage.ammo = {
    autoCalculate,
    targetCount,
    roundsPerTarget,
    roundsPerRun: rounds,
    runs,
    roundsPerShooterTotal: rounds * runs,
    manualAmmoNote: $("manualAmmoNote").value
  };
  readMags("handgun");
  readMags("longGun");
  renderWeaponDependent();
  renderAmmoFields();
  calculateDifficulty();
  markDirty();
}

function renderWeaponDependent() {
  const w = currentStage.weaponType;
  $("handgunStartWrap").hidden = w === "langwaffe";
  $("longGunStartWrap").hidden = w === "kurzwaffe";
  $("handgunMagWrap").hidden = w === "langwaffe";
  $("longGunMagWrap").hidden = w === "kurzwaffe";
  $("manualDifficultyWrap").hidden = !$("difficultyOverrideEnabled").checked;
}

function normalizeAmmoState() {
  currentStage.ammo = {
    autoCalculate: currentStage.ammo.autoCalculate !== false,
    targetCount: countTargets(),
    roundsPerTarget: Math.max(1, Number(currentStage.ammo.roundsPerTarget || 2)),
    roundsPerRun: Math.max(0, Number(currentStage.ammo.roundsPerRun || 0)),
    runs: Math.max(1, Number(currentStage.ammo.runs || 1)),
    roundsPerShooterTotal: 0,
    manualAmmoNote: currentStage.ammo.manualAmmoNote || ""
  };
  if (currentStage.ammo.autoCalculate) {
    currentStage.ammo.roundsPerRun = currentStage.ammo.targetCount * currentStage.ammo.roundsPerTarget;
  }
  currentStage.ammo.roundsPerShooterTotal = currentStage.ammo.roundsPerRun * currentStage.ammo.runs;
}

function renderAmmoFields() {
  normalizeAmmoState();
  $("ammoAutoCalculate").checked = !!currentStage.ammo.autoCalculate;
  $("targetCount").value = currentStage.ammo.targetCount;
  $("roundsPerTarget").value = currentStage.ammo.roundsPerTarget;
  $("roundsPerRun").value = currentStage.ammo.roundsPerRun;
  $("roundsPerRun").readOnly = !!currentStage.ammo.autoCalculate;
  $("roundsTotal").textContent = String(currentStage.ammo.roundsPerShooterTotal);
}

function countTargets() {
  return (currentStage.objects || []).filter(obj => obj.type === "target").length;
}

function calculateDifficulty() {
  const focus = new Set(currentStage.focusAreas);
  const objects = currentStage.objects || [];
  const targetCount = objects.filter(obj => obj.type === "target").length;
  const noShootCount = objects.filter(obj => obj.type === "noShoot").length;
  const backstopCount = objects.filter(obj => obj.type === "backstop").length;
  const lightCount = objects.filter(obj => obj.type === "light").length;
  const isTwoGunDynamic = currentStage.weaponType === "kurzwaffe_langwaffe" && ["dynamisch", "kombiniert"].includes(currentStage.trainingType);

  let level;
  let reason;
  if (focus.has("Team")) {
    level = "Schwer";
    reason = "Schwere Schwierigkeit: Teamdrill.";
  } else if (isTwoGunDynamic && targetCount >= 4 && backstopCount >= 1) {
    level = "Schwer";
    reason = "Schwere Schwierigkeit: 2-Gun dynamisch mit mindestens vier Scheiben und mobilem Kugelfang.";
  } else if (["dynamisch", "kombiniert"].includes(currentStage.trainingType)) {
    level = "Mittel";
    reason = currentStage.weaponType === "kurzwaffe_langwaffe"
      ? "Mittlere Schwierigkeit: dynamische Einzelübung mit Kurzwaffe und Langwaffe."
      : "Mittlere Schwierigkeit: dynamische Einzelübung mit Bewegung oder mehreren Zielen.";
  } else if (backstopCount || targetCount > 3 || noShootCount || lightCount) {
    level = "Mittel";
    reason = "Mittlere Schwierigkeit: statische Übung mit mehreren Elementen.";
  } else if (objects.length <= 4 && targetCount <= 3) {
    level = "Leicht";
    reason = "Leichte Schwierigkeit: statische Übung mit klarer Schussrichtung und wenigen Zielen.";
  } else {
    level = "Mittel";
    reason = "Mittlere Schwierigkeit: statische Übung mit mehreren Elementen.";
  }
  currentStage.difficultyCalculated = level;
  currentStage.difficultyReasons = [reason];
  $("difficultyCalculated").textContent = level;
  $("difficultyReasons").textContent = reason;
}

function renderStage() {
  const svg = $("stageSvg");
  svg.innerHTML = "";
  if (!activeRange) {
    svg.removeAttribute("viewBox");
    svg.style.width = "100%";
    svg.style.height = "520px";
    return;
  }
  const pad = 1.2;
  const width = activeRange.widthM;
  const height = activeRange.heightM;
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`);
  const pxW = Math.min(900, Math.max(420, width * activeRange.pixelsPerMeter + 80));
  const pxH = Math.min(1200, Math.max(520, height * activeRange.pixelsPerMeter + 80));
  svg.style.width = `${pxW}px`;
  svg.style.height = `${pxH}px`;
  svg.append(el("rect", { x: 0, y: 0, width, height, class: "range-shell" }));
  for (let x = activeRange.gridM; x < width; x += activeRange.gridM) svg.append(el("line", { x1: x, y1: 0, x2: x, y2: height, class: "grid-line" }));
  for (let y = activeRange.gridM; y < height; y += activeRange.gridM) svg.append(el("line", { x1: 0, y1: y, x2: width, y2: y, class: "grid-line" }));
  renderMeterMarks(svg, width, height);
  renderBoundarySegments(svg, activeRange, false);
  const ordered = sortedObjects();
  ordered.filter(obj => obj.id !== selectedObjectId).forEach(obj => svg.append(objectNode(obj)));
  const selected = selectedObject();
  if (selected) svg.append(objectNode(selected));
  ordered.forEach(obj => {
    if (obj.label) svg.append(labelNode(obj));
  });
  if (selected) svg.append(selectionNode(selected));
  svg.onpointermove = onPointerMove;
  svg.onpointerup = endDrag;
  svg.onpointerleave = endDrag;
}

function shouldLabelMeter(i, maxMeter) {
  return i === 0 || i === maxMeter || i % 5 === 0;
}

function renderMeterMarks(svg, width, height) {
  const maxX = Math.floor(width);
  const maxY = Math.floor(height);
  const tick = .16;
  for (let y = 0; y <= maxY; y++) {
    svg.append(el("line", { x1: 0, y1: y, x2: -tick, y2: y, class: "meter-tick" }));
    if (shouldLabelMeter(y, maxY)) {
      svg.append(el("text", { x: -tick - .06, y: y + .08, "text-anchor": "end", class: "meter-label" }, `${y} m`));
    }
  }
  for (let x = 0; x <= maxX; x++) {
    svg.append(el("line", { x1: x, y1: height, x2: x, y2: height + tick, class: "meter-tick" }));
    if (shouldLabelMeter(x, maxX)) {
      svg.append(el("text", { x, y: height + tick + .24, "text-anchor": "middle", class: "meter-label" }, `${x} m`));
    }
  }
}

function sortedObjects() {
  return [...(currentStage.objects || [])].sort((a, b) => {
    const orderA = renderOrder[a.type] || 50;
    const orderB = renderOrder[b.type] || 50;
    if (orderA !== orderB) return orderA - orderB;
    return currentStage.objects.indexOf(a) - currentStage.objects.indexOf(b);
  });
}

function renderBoundarySegments(svg, range, editable) {
  const segs = activeSet(range.boundaryBackstops);
  const addSeg = (side, i) => {
    const geom = getBoundarySegmentGeometry(range, side, i);
    const active = segs.has(`${side}:${i}`);
    const group = el("g", { class: "boundary-segment" });
    const visible = el("line", {
      x1: geom.x1, y1: geom.y1, x2: geom.x2, y2: geom.y2,
      class: `boundary-visible ${active ? "active" : ""}`
    });
    const hit = el("line", {
      x1: geom.x1, y1: geom.y1, x2: geom.x2, y2: geom.y2,
      class: "boundary-hit"
    });
    group.append(visible);
    if (editable) {
      group.append(el("title", {}, "Kugelfang umschalten"));
      group.append(hit);
      group.addEventListener("click", () => toggleBoundary(side, i));
    }
    svg.append(group);
  };
  for (let i = 0; i < Math.round(range.widthM); i++) {
    addSeg("top", i);
    addSeg("bottom", i);
  }
  for (let i = 0; i < Math.round(range.heightM); i++) {
    addSeg("left", i);
    addSeg("right", i);
  }
}

function getBoundarySegmentGeometry(range, side, meterIndex) {
  const width = Number(range.widthM);
  const height = Number(range.heightM);
  const i = Number(meterIndex);
  if (side === "top") return { x1: i, y1: 0, x2: i + 1, y2: 0 };
  if (side === "bottom") return { x1: i, y1: height, x2: i + 1, y2: height };
  if (side === "left") return { x1: 0, y1: i, x2: 0, y2: i + 1 };
  return { x1: width, y1: i, x2: width, y2: i + 1 };
}

function activeSet(items) {
  return new Set((items || []).filter(b => b.active).map(b => `${b.side}:${b.meterIndex}`));
}

function objectNode(obj) {
  const box = displayBox(obj);
  const g = el("g", { class: "stage-object", transform: `rotate(${obj.rotation || 0} ${box.cx} ${box.cy})` });
  appendObjectSymbol(g, obj, box);
  g.addEventListener("pointerdown", (event) => startDrag(event, obj.id));
  return g;
}

function labelNode(obj) {
  const box = displayBox(obj);
  return el("text", { x: box.x, y: box.y - .12, class: "obj-label" }, obj.label);
}

function selectionNode(obj) {
  const box = displayBox(obj);
  return el("rect", {
    x: box.x - .08,
    y: box.y - .08,
    width: box.w + .16,
    height: box.h + .16,
    rx: .08,
    class: "selected-glow",
    transform: `rotate(${obj.rotation || 0} ${box.cx} ${box.cy})`
  });
}

function getObjectGeometry(obj, scale, stageOriginX, stageOriginY) {
  const spec = symbolContract.objects[obj.type] || {};
  const ppm = Math.max(10, Number(activeRange ? activeRange.pixelsPerMeter : 32));
  const realW = Number(obj.widthM || 0);
  const realH = Number(obj.heightM || 0);
  const centerX = stageOriginX + (Number(obj.xM || 0) + realW / 2) * scale;
  const centerY = stageOriginY + (Number(obj.yM || 0) + realH / 2) * scale;
  let widthPx;
  let heightPx;
  if (spec.fixedVisual) {
    widthPx = Number(spec.visualWidthPx || 16) / ppm * scale;
    heightPx = Number(spec.visualHeightPx || 16) / ppm * scale;
  } else {
    const minM = Math.max(.22, 20 / ppm);
    widthPx = Math.max(realW, minM) * scale;
    heightPx = Math.max(realH, minM) * scale;
  }
  return {
    xPx: centerX - widthPx / 2,
    yPx: centerY - heightPx / 2,
    widthPx,
    heightPx,
    centerX,
    centerY,
    rotationRad: (Number(obj.rotation || 0) * Math.PI) / 180
  };
}

function displayBox(obj) {
  const g = getObjectGeometry(obj, 1, 0, 0);
  return { x: g.xPx, y: g.yPx, w: g.widthPx, h: g.heightPx, cx: g.centerX, cy: g.centerY };
}

function appendObjectSymbol(g, obj, b) {
  const theme = symbolTheme[obj.type] || { fill: "#93c5fd", stroke: "#111827" };
  const stroke = theme.stroke;
  if (obj.type === "target") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .04, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .32, class: "symbol-mark" }));
    g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .14, class: "symbol-mark" }));
  } else if (obj.type === "noShoot") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .04, fill: theme.fill, stroke: theme.stroke, "stroke-width": .05 }));
    g.append(el("line", { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, class: "symbol-red" }));
    g.append(el("line", { x1: b.x + b.w, y1: b.y, x2: b.x, y2: b.y + b.h, class: "symbol-red" }));
  } else if (obj.type === "start") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .08, fill: theme.fill, stroke, "stroke-width": .05 }));
    g.append(el("line", { x1: b.x + b.w * .35, y1: b.y + b.h * .75, x2: b.x + b.w * .35, y2: b.y + b.h * .2, class: "symbol-mark" }));
    g.append(el("polygon", { points: `${b.x + b.w * .35},${b.y + b.h * .2} ${b.x + b.w * .78},${b.y + b.h * .34} ${b.x + b.w * .35},${b.y + b.h * .48}`, fill: theme.accent, stroke, "stroke-width": .04 }));
  } else if (obj.type === "barrel") {
    g.append(el("ellipse", { cx: b.cx, cy: b.cy, rx: b.w * .45, ry: b.h * .45, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("line", { x1: b.x + b.w * .18, y1: b.cy, x2: b.x + b.w * .82, y2: b.cy, class: "symbol-mark" }));
  } else if (obj.type === "cone") {
    g.append(el("polygon", { points: `${b.cx},${b.y} ${b.x + b.w * .88},${b.y + b.h * .9} ${b.x + b.w * .12},${b.y + b.h * .9}`, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("line", { x1: b.x + b.w * .3, y1: b.y + b.h * .62, x2: b.x + b.w * .7, y2: b.y + b.h * .62, class: "symbol-mark" }));
  } else if (obj.type === "barricade") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .03, fill: theme.fill, stroke, "stroke-width": .04 }));
    for (let i = .2; i < .9; i += .25) g.append(el("line", { x1: b.x + b.w * i, y1: b.y, x2: b.x + b.w * (i - .18), y2: b.y + b.h, class: "symbol-mark" }));
  } else if (obj.type === "light") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .08, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("polygon", { points: `${b.cx},${b.y + b.h * .12} ${b.x + b.w * .36},${b.cy} ${b.cx},${b.cy} ${b.x + b.w * .42},${b.y + b.h * .88} ${b.x + b.w * .68},${b.y + b.h * .42} ${b.cx},${b.y + b.h * .42}`, fill: "#111827", stroke: "#111827", "stroke-width": .01 }));
  } else if (obj.type === "arrow") {
    g.append(el("polygon", { points: `${b.x},${b.y + b.h * .34} ${b.x + b.w * .58},${b.y + b.h * .34} ${b.x + b.w * .58},${b.y + b.h * .14} ${b.x + b.w},${b.cy} ${b.x + b.w * .58},${b.y + b.h * .86} ${b.x + b.w * .58},${b.y + b.h * .66} ${b.x},${b.y + b.h * .66}`, fill: theme.fill, stroke, "stroke-width": .04 }));
  } else {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .05, fill: theme.fill, stroke, "stroke-width": .04 }));
    if (obj.type === "wall") g.append(el("line", { x1: b.x, y1: b.cy, x2: b.x + b.w, y2: b.cy, class: "symbol-mark" }));
    if (obj.type === "backstop") {
      g.append(el("polygon", { points: `${b.x + b.w * .08},${b.y + b.h * .15} ${b.x + b.w * .92},${b.y + b.h * .15} ${b.x + b.w * .82},${b.y + b.h * .85} ${b.x + b.w * .18},${b.y + b.h * .85}`, fill: theme.fill, stroke, "stroke-width": .04 }));
      g.append(el("line", { x1: b.x + b.w * .26, y1: b.cy, x2: b.x + b.w * .74, y2: b.cy, stroke: theme.accent, "stroke-width": .04 }));
    }
    if (obj.type === "note") g.append(el("text", { x: b.x + b.w * .18, y: b.y + b.h * .62, "font-size": Math.min(b.w, b.h) * .55, fill: "#111827" }, "T"));
    if (obj.type === "marker") g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .28, class: "symbol-mark" }));
  }
}

function colorFor(type) {
  return (symbolTheme[type] && symbolTheme[type].fill) || "#93c5fd";
}

function addObject(type) {
  if (!activeRange) return setStatus("Bitte zuerst einen Schiesskeller wählen", true);
  const def = objectTypes[type];
  const obj = {
    id: crypto.randomUUID(),
    type,
    xM: Math.max(.2, activeRange.widthM / 2 - def.widthM / 2),
    yM: Math.max(.2, activeRange.heightM / 2 - def.heightM / 2),
    widthM: def.widthM,
    heightM: def.heightM,
    rotation: 0,
    label: "",
    properties: {}
  };
  applyCenterBounds(obj);
  currentStage.objects.push(obj);
  selectedObjectId = obj.id;
  renderAmmoFields();
  calculateDifficulty();
  renderStage();
  renderObjectForm();
  markDirty();
}

function startDrag(event, id) {
  event.preventDefault();
  selectedObjectId = id;
  const obj = selectedObject();
  const p = svgPoint(event);
  dragState = { id, dx: p.x - obj.xM, dy: p.y - obj.yM };
  activateTab("object");
  renderStage();
  renderObjectForm();
}

function onPointerMove(event) {
  if (!dragState || !activeRange) return;
  const obj = selectedObject();
  const p = svgPoint(event);
  obj.xM = round2(p.x - dragState.dx);
  obj.yM = round2(p.y - dragState.dy);
  applyCenterBounds(obj);
  renderStage();
  renderObjectForm();
  markDirty();
}

function endDrag() { dragState = null; }

function svgPoint(event) {
  const svg = $("stageSvg");
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function selectedObject() {
  return currentStage.objects.find(o => o.id === selectedObjectId);
}

function renderObjectForm() {
  const obj = selectedObject();
  if (!obj) {
    $("objectForm").className = "object-form muted";
    $("objectForm").textContent = "Kein Objekt ausgewählt";
    return;
  }
  $("objectForm").className = "object-form";
  $("objectForm").innerHTML = `
    <div class="object-actions object-actions-panel">
      <button id="objRotateLeft" type="button">-15°</button>
      <button id="objRotateRight" type="button">+15°</button>
      <button id="objDuplicate" type="button">Duplizieren</button>
      <button id="objDelete" type="button">Löschen</button>
    </div>
    <label>Typ<select id="objType">${Object.entries(objectTypes).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
    <div class="muted">X/Y beziehen sich auf die Objektmitte</div>
    <div class="grid2">
      <label>X Position Mitte m<input id="objX" type="number" step="0.1"></label>
      <label>Y Position Mitte m<input id="objY" type="number" step="0.1"></label>
      <label>Breite m<input id="objW" type="number" step="0.1" min="0.1"></label>
      <label>Höhe/Tiefe m<input id="objH" type="number" step="0.1" min="0.1"></label>
      <label>Rotation °<input id="objRot" type="number" step="5"></label>
      <label>Label<input id="objLabel"></label>
    </div>`;
  const center = objectCenterM(obj);
  $("objType").value = obj.type; $("objX").value = round2(center.x); $("objY").value = round2(center.y);
  $("objW").value = obj.widthM; $("objH").value = obj.heightM; $("objRot").value = obj.rotation; $("objLabel").value = obj.label || "";
  $("objRotateLeft").addEventListener("click", () => rotateSelectedObject(-15));
  $("objRotateRight").addEventListener("click", () => rotateSelectedObject(15));
  $("objDuplicate").addEventListener("click", duplicateSelectedObject);
  $("objDelete").addEventListener("click", deleteSelectedObject);
  ["objType", "objX", "objY", "objW", "objH", "objRot", "objLabel"].forEach(id => $(id).addEventListener("input", readObjectForm));
}

function readObjectForm() {
  const obj = selectedObject();
  if (!obj) return;
  obj.type = $("objType").value;
  obj.widthM = Math.max(.1, Number($("objW").value || .1));
  obj.heightM = Math.max(.1, Number($("objH").value || .1));
  const centerX = Number($("objX").value || 0);
  const centerY = Number($("objY").value || 0);
  obj.xM = centerX - obj.widthM / 2;
  obj.yM = centerY - obj.heightM / 2;
  applyCenterBounds(obj);
  obj.rotation = Number($("objRot").value || 0);
  obj.label = $("objLabel").value;
  renderStage();
  markDirty();
}

function objectCenterM(obj) {
  return {
    x: Number(obj.xM || 0) + Number(obj.widthM || 0) / 2,
    y: Number(obj.yM || 0) + Number(obj.heightM || 0) / 2
  };
}

function applyCenterBounds(obj) {
  if (!activeRange || !obj) return;
  const minX = -obj.widthM / 2;
  const maxX = activeRange.widthM - obj.widthM / 2;
  const minY = -obj.heightM / 2;
  const maxY = activeRange.heightM - obj.heightM / 2;
  obj.xM = clamp(obj.xM, minX, maxX);
  obj.yM = clamp(obj.yM, minY, maxY);
}

function deleteSelectedObject() {
  if (!selectedObjectId) return;
  currentStage.objects = currentStage.objects.filter(o => o.id !== selectedObjectId);
  selectedObjectId = null;
  renderAmmoFields();
  calculateDifficulty();
  renderStage();
  renderObjectForm();
  markDirty();
}

function rotateSelectedObject(delta) {
  const obj = selectedObject();
  if (!obj) return;
  obj.rotation = normalizeRotation((Number(obj.rotation) || 0) + delta);
  renderStage();
  renderObjectForm();
  markDirty();
}

function duplicateSelectedObject() {
  const obj = selectedObject();
  if (!obj || !activeRange) return;
  const copy = JSON.parse(JSON.stringify(obj));
  copy.id = crypto.randomUUID();
  copy.xM = round2(copy.xM + .5);
  copy.yM = round2(copy.yM + .5);
  applyCenterBounds(copy);
  currentStage.objects.push(copy);
  selectedObjectId = copy.id;
  renderAmmoFields();
  calculateDifficulty();
  renderStage();
  renderObjectForm();
  activateTab("object");
  markDirty();
}

function handleShortcuts(event) {
  const tag = (event.target && event.target.tagName || "").toLowerCase();
  const editingText = ["input", "textarea", "select"].includes(tag);
  if (editingText && !(event.ctrlKey && event.key.toLowerCase() === "d")) return;
  if (event.key.toLowerCase() === "q") {
    event.preventDefault();
    rotateSelectedObject(-15);
  } else if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    rotateSelectedObject(15);
  } else if (event.ctrlKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelectedObject();
  } else if (event.key === "Delete") {
    event.preventDefault();
    deleteSelectedObject();
  }
}

function normalizeRotation(value) {
  let angle = value % 360;
  if (angle < 0) angle += 360;
  return angle;
}

function renderMags(kind) {
  const wrap = $(kind === "handgun" ? "handgunMags" : "longGunMags");
  const section = currentStage.magPrep[kind];
  wrap.innerHTML = section.magazines.map((mag, i) => `
    <div class="mag-row" data-kind="${kind}" data-index="${i}">
      <span>${escapeHtml(mag.name)}</span>
      <select class="mag-state">
        <option value="voll">Voll</option><option value="leer">Leer</option><option value="anzahl">Anzahl Schuss</option>
      </select>
      <input class="mag-rounds" type="number" min="0" step="1" value="${mag.rounds == null ? 0 : mag.rounds}">
    </div>`).join("");
  wrap.querySelectorAll(".mag-row").forEach((row, i) => {
    row.querySelector(".mag-state").value = section.magazines[i].state;
    row.querySelector(".mag-rounds").hidden = section.magazines[i].state !== "anzahl";
    row.querySelector(".mag-state").addEventListener("change", () => { readMags(kind); renderMags(kind); });
    row.querySelector(".mag-rounds").addEventListener("input", () => readMags(kind));
  });
}

function readMags(kind) {
  const wrap = $(kind === "handgun" ? "handgunMags" : "longGunMags");
  const rows = [...wrap.querySelectorAll(".mag-row")];
  if (!rows.length) return;
  currentStage.magPrep[kind].magazines = rows.map((row, i) => {
    const state = row.querySelector(".mag-state").value;
    return { name: `Magazin ${i + 1}`, state, rounds: state === "anzahl" ? Number(row.querySelector(".mag-rounds").value || 0) : null };
  });
  currentStage.magPrep[kind].magazineCount = rows.length;
}

function resizeMags(kind, count) {
  const section = currentStage.magPrep[kind];
  count = Math.max(0, Math.floor(count));
  while (section.magazines.length < count) section.magazines.push({ name: `Magazin ${section.magazines.length + 1}`, state: "voll", rounds: null });
  section.magazines = section.magazines.slice(0, count).map((m, i) => ({ ...m, name: `Magazin ${i + 1}` }));
  section.magazineCount = count;
  renderMags(kind);
  markDirty();
}

async function newStage() {
  currentStage = blankStage((activeRange && activeRange.id) || (ranges[0] && ranges[0].id) || null);
  currentStage.version = "v1.0";
  selectedObjectId = null;
  syncStageToForm();
  renderStage();
  markDirty();
  setStatus("Neue Stage angelegt, noch nicht gespeichert");
}

function openSettingsDialog() {
  $("settingAuthorName").value = appSettings.authorName || "";
  $("settingFooterText").value = appSettings.customFooterText || "";
  $("settingDefaultVersion").value = appSettings.defaultVersion || "v1.0";
  $("settingsDialog").showModal();
}

async function saveSettings() {
  appSettings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      authorName: $("settingAuthorName").value,
      customFooterText: $("settingFooterText").value,
      defaultVersion: $("settingDefaultVersion").value || "v1.0"
    })
  });
  setStatus("PDF Einstellungen gespeichert");
}

async function saveStage() {
  try {
    setSaveState("saving", "Wird gespeichert...");
    readStageFromForm();
    const method = currentStage.id ? "PUT" : "POST";
    const url = currentStage.id ? `/api/stages/${currentStage.id}` : "/api/stages";
    currentStage = await api(url, { method, body: JSON.stringify(currentStage) });
    await loadStages();
    syncStageToForm();
    renderStage();
    stageDirty = false;
    setSaveState("saved", "Gespeichert");
    setStatus("Stage gespeichert");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openLoadDialog() {
  await loadStages();
  $("stageList").innerHTML = stages.map(s => `<button type="button" data-id="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(labelWeapon(s.weaponType))}</button>`).join("") || "<div class='muted'>Keine Stages gespeichert</div>";
  $("stageList").querySelectorAll("button").forEach(btn => btn.addEventListener("click", async () => {
    const payload = await api(`/api/stages/${btn.dataset.id}`);
    currentStage = payload.stage;
    activeRange = payload.range;
    selectedObjectId = null;
    renderRangeSelect();
    syncStageToForm();
    renderStage();
    $("loadDialog").close();
    stageDirty = false;
    setSaveState("saved", "Gespeichert");
    setStatus("Stage geladen");
  }));
  $("loadDialog").showModal();
}

async function duplicateStage() {
  if (!currentStage.id) return setStatus("Stage zuerst speichern", true);
  currentStage = await api(`/api/stages/${currentStage.id}/duplicate`, { method: "POST" });
  await loadStages();
  syncStageToForm();
  stageDirty = false;
  setSaveState("saved", "Gespeichert");
  setStatus("Stage dupliziert");
}

function exportPdf() {
  if (!currentStage.id) return setStatus("Stage zuerst speichern", true);
  window.location.href = `/api/stages/${currentStage.id}/pdf`;
}

function exportJson() {
  if (!currentStage.id) return setStatus("Stage zuerst speichern", true);
  window.location.href = `/api/stages/${currentStage.id}/export.json`;
}

async function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    currentStage = await api("/api/import", { method: "POST", body: JSON.stringify(payload) });
    await loadRanges();
    activeRange = ranges.find(r => r.id === currentStage.rangeId) || ranges[0];
    renderRangeSelect();
    syncStageToForm();
    renderStage();
    stageDirty = false;
    setSaveState("saved", "Gespeichert");
    setStatus("JSON importiert");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    event.target.value = "";
  }
}

function openRangeDialog() {
  editingRange = activeRange || ranges[0] || blankRange();
  renderRangeList();
  syncRangeToForm();
  renderBoundaryEditor();
  $("rangeDialog").showModal();
}

function blankRange() {
  return { id: null, name: "Neuer Schiesskeller", description: "", widthM: 8, heightM: 25, gridM: 1, pixelsPerMeter: 32, boundaryBackstops: [], notes: "" };
}

function renderRangeList() {
  $("rangeList").innerHTML = ranges.length
    ? ranges.map(r => `<button type="button" class="${editingRange && editingRange.id === r.id ? "active" : ""}" data-id="${r.id}">${escapeHtml(r.name)}<br><small>${r.widthM} x ${r.heightM} m</small></button>`).join("")
    : "<div class='empty-list'>Keine Schiesskeller gespeichert</div>";
  $("rangeList").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    editingRange = ranges.find(r => String(r.id) === btn.dataset.id);
    renderRangeList();
    syncRangeToForm();
    renderBoundaryEditor();
  }));
}

function newEditingRange() {
  editingRange = blankRange();
  renderRangeList();
  syncRangeToForm();
  renderBoundaryEditor();
}

function syncRangeToForm() {
  $("rangeName").value = editingRange.name || "";
  $("rangeDescription").value = editingRange.description || "";
  $("rangeWidth").value = editingRange.widthM || 8;
  $("rangeHeight").value = editingRange.heightM || 25;
  $("rangeGrid").value = editingRange.gridM || 1;
  $("rangePpm").value = editingRange.pixelsPerMeter || 32;
  $("rangeNotes").value = editingRange.notes || "";
}

function readEditingRange() {
  if (!editingRange) editingRange = blankRange();
  editingRange.name = $("rangeName").value;
  editingRange.description = $("rangeDescription").value;
  editingRange.widthM = Math.max(1, Number($("rangeWidth").value || 8));
  editingRange.heightM = Math.max(1, Number($("rangeHeight").value || 25));
  editingRange.gridM = Math.max(.5, Number($("rangeGrid").value || 1));
  editingRange.pixelsPerMeter = Math.max(10, Number($("rangePpm").value || 32));
  editingRange.notes = $("rangeNotes").value;
  editingRange.boundaryBackstops = (editingRange.boundaryBackstops || []).filter(b => {
    const max = ["top", "bottom"].includes(b.side) ? editingRange.widthM : editingRange.heightM;
    return b.meterIndex >= 0 && b.meterIndex < Math.round(max);
  });
}

function renderBoundaryEditor() {
  const svg = $("boundarySvg");
  svg.innerHTML = "";
  if (!editingRange) return;
  const pad = 1.3;
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${editingRange.widthM + pad * 2} ${editingRange.heightM + pad * 2}`);
  svg.append(el("rect", { x: 0, y: 0, width: editingRange.widthM, height: editingRange.heightM, class: "range-shell" }));
  for (let x = 1; x < editingRange.widthM; x++) svg.append(el("line", { x1: x, y1: 0, x2: x, y2: editingRange.heightM, class: "grid-line" }));
  for (let y = 1; y < editingRange.heightM; y++) svg.append(el("line", { x1: 0, y1: y, x2: editingRange.widthM, y2: y, class: "grid-line" }));
  renderBoundarySegments(svg, editingRange, true);
}

function toggleBoundary(side, meterIndex) {
  const key = `${side}:${meterIndex}`;
  const set = activeSet(editingRange.boundaryBackstops);
  if (set.has(key)) {
    editingRange.boundaryBackstops = editingRange.boundaryBackstops.filter(b => !(b.side === side && b.meterIndex === meterIndex));
  } else {
    editingRange.boundaryBackstops.push({ side, meterIndex, active: true });
  }
  renderBoundaryEditor();
}

async function saveRange() {
  try {
    readEditingRange();
    const method = editingRange.id ? "PUT" : "POST";
    const url = editingRange.id ? `/api/ranges/${editingRange.id}` : "/api/ranges";
    const saved = await api(url, { method, body: JSON.stringify(editingRange) });
    await loadRanges();
    editingRange = saved;
    activeRange = saved;
    currentStage.rangeId = saved.id;
    renderRangeList();
    renderRangeSelect();
    renderBoundaryEditor();
    renderStage();
    updateTopbarMeta();
    markDirty();
    setStatus("Schiesskeller gespeichert");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteRange() {
  if (!editingRange || !editingRange.id) return;
  if (!confirm("Schiesskeller löschen? Zugehörige Stages werden ebenfalls gelöscht.")) return;
  await api(`/api/ranges/${editingRange.id}`, { method: "DELETE" });
  await loadRanges();
  activeRange = ranges[0] || null;
  editingRange = activeRange || blankRange();
  currentStage = blankStage((activeRange && activeRange.id) || null);
  renderRangeList();
  renderRangeSelect();
  syncRangeToForm();
  syncStageToForm();
  renderBoundaryEditor();
  renderStage();
  updateTopbarMeta();
  markDirty();
}

function el(name, attrs = {}, text = null) {
  const node = document.createElementNS(ns, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== null) node.textContent = text;
  return node;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round2(value) { return Math.round(value * 100) / 100; }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
function labelWeapon(value) {
  return { kurzwaffe: "Kurzwaffe", langwaffe: "Langwaffe", kurzwaffe_langwaffe: "Kurzwaffe + Langwaffe" }[value] || value;
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch(error => setStatus(error.message, true));
});
