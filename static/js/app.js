const focusAreas = [
  "Präzision", "Speed", "Draw / Ready", "Reloads", "Störungen", "Zielwechsel",
  "Bewegung", "Deckung / Wand", "Entscheidung / No-Shoot", "Licht / Reaktion",
  "Einhand", "Langwaffe", "Waffenwechsel", "Team", "Standard / Test"
];
const targetTypes = ["IPSC Target", "IDPA Target", "CMA Target", "Target", "Manscheibe", "Belgische Zielscheibe", "Custom"];
const targetVariants = [
  { value: "full", label: "Voll" },
  { value: "no-shoot", label: "No-Shoot" },
  { value: "half", label: "Halbe Scheibe" },
  { value: "head-only", label: "Nur Kopf" },
  { value: "custom", label: "Custom" }
];
const variantDirections = [
  { value: "left", label: "Links" },
  { value: "right", label: "Rechts" },
  { value: "top", label: "Oben" },
  { value: "bottom", label: "Unten" }
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
const hiddenObjectTypes = new Set(["swinger", "mover"]);

const $ = (id) => document.getElementById(id);
const ns = "http://www.w3.org/2000/svg";

let ranges = [];
let stages = [];
let activeRange = null;
let editingRange = null;
let appSettings = { authorName: "", customFooterText: "", defaultVersion: "v1.0" };
let currentStage = null;
let selectedObjectId = null;
let selectedObjectIds = new Set();
let dragState = null;
let stageDirty = false;
let snapEnabled = true;
let alignmentGuides = [];
let undoStack = [];
let redoStack = [];
let pendingObjectFormSnapshot = null;
let objectFormHistoryTimer = null;

const HISTORY_LIMIT = 60;
const SNAP_THRESHOLD_M = 0.16;
const CURRENT_STAGE_ID_KEY = "stagebuilder-current-stage-id";
const CURRENT_STAGE_DIRTY_KEY = "stagebuilder-current-stage-dirty";

const lightModes = [
  { value: "color", label: "Color" },
  { value: "false-color", label: "False Color" },
  { value: "delay", label: "Delay" },
  { value: "timeout", label: "Timeout" }
];
const lightColors = [
  { value: "#FF2A2A", label: "Rot" },
  { value: "#42C96A", label: "Grün" },
  { value: "#3A84F7", label: "Blau" },
  { value: "#D9C900", label: "Gelb" },
  { value: "#C24AF5", label: "Violett" },
  { value: "#25CFF5", label: "Cyan" }
];
const lightTimerSteps = [
  { value: "infinite", label: "∞" },
  { value: "10", label: "10 s" },
  { value: "15", label: "15 s" },
  { value: "30", label: "30 s" },
  { value: "45", label: "45 s" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
  { value: "180", label: "3 min" },
  { value: "300", label: "5 min" },
  { value: "600", label: "10 min" }
];
const structureTypes = new Set(["wall", "window", "door"]);

const renderOrder = {
  wall: 10,
  window: 11,
  door: 12,
  backstop: 20,
  barrel: 40,
  cone: 40,
  light: 40,
  note: 40,
  arrow: 40,
  marker: 40,
  popper: 68,
  steelPlate: 68,
  swinger: 68,
  mover: 68,
  plateRack: 68,
  activator: 68,
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
    targetType: "Target",
    targetTypeCustom: "",
    targetNumbering: { enabled: false, prefix: "T", start: 1, mode: "creation-order" },
    setupListAuto: true,
    setupListText: "",
    lightSettings: defaultLightProperties(),
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
  localStorage.setItem(CURRENT_STAGE_DIRTY_KEY, "1");
  setSaveState("dirty", "Ungespeicherte Änderungen");
}

function rememberSavedStageReference() {
  if (currentStage && currentStage.id) {
    localStorage.setItem(CURRENT_STAGE_ID_KEY, String(currentStage.id));
    localStorage.setItem(CURRENT_STAGE_DIRTY_KEY, "0");
  } else {
    localStorage.removeItem(CURRENT_STAGE_ID_KEY);
    localStorage.setItem(CURRENT_STAGE_DIRTY_KEY, "1");
  }
}

function clearSavedStageReference() {
  localStorage.removeItem(CURRENT_STAGE_ID_KEY);
  localStorage.setItem(CURRENT_STAGE_DIRTY_KEY, "1");
}

async function init() {
  snapEnabled = localStorage.getItem("stagebuilder-snap-enabled") !== "0";
  $("snapToggle").checked = snapEnabled;
  buildFocusGrid();
  bindEvents();
  initToolbarGroups();
  await loadSettings();
  await loadRanges();
  await loadStages();
  const restored = await restoreSavedStageReference();
  if (!restored) {
    activeRange = ranges[0] || null;
    currentStage = blankStage(activeRange ? activeRange.id : null);
    currentStage.version = "v1.0";
    localStorage.setItem(CURRENT_STAGE_DIRTY_KEY, "0");
  }
  syncStageToForm();
  renderRangeSelect();
  renderStage();
  updateTopbarMeta();
  setSaveState("saved", "Gespeichert");
  setStatus(activeRange ? "Bereit" : "Bitte zuerst einen Schiesskeller erstellen");
}

async function restoreSavedStageReference() {
  const storedId = localStorage.getItem(CURRENT_STAGE_ID_KEY);
  const wasDirty = localStorage.getItem(CURRENT_STAGE_DIRTY_KEY) === "1";
  if (!storedId || wasDirty) return false;
  try {
    const payload = await api(`/api/stages/${storedId}`);
    currentStage = payload.stage;
    activeRange = payload.range || ranges.find(r => r.id === currentStage.rangeId) || ranges[0] || null;
    stageDirty = false;
    return true;
  } catch {
    localStorage.removeItem(CURRENT_STAGE_ID_KEY);
    return false;
  }
}

function initToolbarGroups() {
  const defaults = { targets: true, props: false };
  const keys = Object.keys(defaults);
  keys.forEach((key) => {
    const saved = localStorage.getItem(`toolbar-group-${key}`);
    const isOpen = saved == null ? defaults[key] : saved === "1";
    setToolbarGroupState(key, isOpen);
  });
  document.querySelectorAll("[data-collapse-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.collapseToggle;
      const group = document.querySelector(`[data-collapse-group="${key}"]`);
      const isOpen = !group.classList.contains("open");
      setToolbarGroupState(key, isOpen);
      localStorage.setItem(`toolbar-group-${key}`, isOpen ? "1" : "0");
    });
  });
}

function setToolbarGroupState(key, isOpen) {
  const group = document.querySelector(`[data-collapse-group="${key}"]`);
  const toggle = document.querySelector(`[data-collapse-toggle="${key}"]`);
  if (!group || !toggle) return;
  group.classList.toggle("open", isOpen);
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  toggle.textContent = `${key === "targets" ? "Targets" : "Props"} ${isOpen ? "▾" : "▸"}`;
}

function bindEvents() {
  $("newStageBtn").addEventListener("click", newStage);
  $("saveStageBtn").addEventListener("click", saveStage);
  $("loadStageBtn").addEventListener("click", openLoadDialog);
  $("duplicateStageBtn").addEventListener("click", duplicateStage);
  $("deleteStageBtn").addEventListener("click", deleteStage);
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
  $("undoBtn").addEventListener("click", undoEditor);
  $("redoBtn").addEventListener("click", redoEditor);
  $("snapToggle").addEventListener("change", () => {
    snapEnabled = $("snapToggle").checked;
    localStorage.setItem("stagebuilder-snap-enabled", snapEnabled ? "1" : "0");
    setStatus(snapEnabled ? "Snap aktiv" : "Snap deaktiviert");
  });
  document.addEventListener("keydown", handleShortcuts);
  ["stageName", "stageVersion", "description", "trainingGoal", "procedure", "safetyNotes", "trainingType", "weaponType",
    "startPositionHandgun", "startPositionLongGun", "difficultyManual", "manualAmmoNote", "defaultTargetType", "defaultTargetTypeCustom",
    "targetNumberingPrefix", "targetNumberingStart", "setupListText"].forEach(id => {
    $(id).addEventListener("input", readStageFromForm);
  });
  ["ammoAutoCalculate", "roundsPerTarget", "roundsPerRun", "runs"].forEach(id => $(id).addEventListener("input", () => { readStageFromForm(); renderAmmoFields(); }));
  $("ammoAutoCalculate").addEventListener("change", () => { readStageFromForm(); renderAmmoFields(); });
  ["stageLightMode", "stageLightColor", "stageLightDelay", "stageLightTimeout", "stageLightTimer", "stageLightCounts", "stageLightSensorMode", "stageLightProbability"].forEach(id => {
    $(id).addEventListener("input", () => { readStageFromForm(); renderStage(); });
  });
  document.querySelectorAll("input[name='stageLightLimitType']").forEach(input => {
    input.addEventListener("change", () => { readStageFromForm(); renderStageLightLimitFields(); renderStage(); });
  });
  $("difficultyOverrideEnabled").addEventListener("change", readStageFromForm);
  $("targetNumberingEnabled").addEventListener("change", () => { readStageFromForm(); applyTargetNumbering(false); renderStage(); });
  $("setupListAuto").addEventListener("change", () => { readStageFromForm(); if ($("setupListAuto").checked) recalculateSetupList(true); renderWeaponDependent(); });
  $("recalcSetupListBtn").addEventListener("click", () => recalculateSetupList(true));
  $("renumberTargetsBtn").addEventListener("click", () => { applyTargetNumbering(true); renderStage(); setStatus("Target-Nummerierung aktualisiert"); });
  $("handgunMagCount").addEventListener("input", () => resizeMags("handgun", Number($("handgunMagCount").value || 0)));
  $("longGunMagCount").addEventListener("input", () => resizeMags("longGun", Number($("longGunMagCount").value || 0)));
  $("newRangeBtn").addEventListener("click", newEditingRange);
  $("saveRangeBtn").addEventListener("click", saveRange);
  $("deleteRangeBtn").addEventListener("click", deleteRange);
  ["stageSearch", "stageFilterRange", "stageFilterWeapon", "stageFilterDifficulty", "stageFilterFocus"].forEach(id => {
    $(id).addEventListener("input", renderStageLoadList);
    $(id).addEventListener("change", renderStageLoadList);
  });
  ["rangeName", "rangeDescription", "rangeWidth", "rangeHeight", "rangeGrid", "rangePpm", "rangeNotes"].forEach(id => {
    $(id).addEventListener("input", () => { readEditingRange(); renderBoundaryEditor(); });
  });
}

function updateObjectActionBar() {
  const bar = $("objectActionsBar");
  if (!bar) return;
  const count = selectedObjects().length;
  bar.hidden = count === 0;
  const title = bar.querySelector(".object-actions-title");
  if (title) title.textContent = count > 1 ? `${count} Objekte:` : "Objekt-Aktionen:";
  const locked = selectedObjects().some(obj => obj.locked);
  ["rotateLeftBtn", "rotateRightBtn", "duplicateObjectBtn", "deleteObjectBtn"].forEach(id => {
    if ($(id)) $(id).disabled = locked;
  });
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if ($("undoBtn")) $("undoBtn").disabled = undoStack.length === 0;
  if ($("redoBtn")) $("redoBtn").disabled = redoStack.length === 0;
}

function cloneObjects() {
  return JSON.parse(JSON.stringify(currentStage.objects || []));
}

function captureEditorState() {
  return {
    objects: cloneObjects(),
    selectedId: selectedObjectId,
    selectedIds: [...selectedObjectIds]
  };
}

function restoreEditorState(state) {
  currentStage.objects = JSON.parse(JSON.stringify(state.objects || []));
  selectedObjectId = state.selectedId || null;
  selectedObjectIds = new Set(state.selectedIds || []);
  if (selectedObjectId && !selectedObjectIds.has(selectedObjectId)) selectedObjectIds.add(selectedObjectId);
  renderAmmoFields();
  renderStageLightSettings();
  calculateDifficulty();
  applyTargetNumbering(false);
  if (currentStage.setupListAuto) recalculateSetupList(true);
  renderStage();
  renderObjectForm();
  markDirty();
}

function statesEqual(a, b) {
  return JSON.stringify(a.objects || []) === JSON.stringify(b.objects || []);
}

function pushUndoState(state = captureEditorState()) {
  undoStack.push(state);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function undoEditor() {
  if (!undoStack.length) return;
  const current = captureEditorState();
  const previous = undoStack.pop();
  redoStack.push(current);
  restoreEditorState(previous);
  setStatus("Undo");
}

function redoEditor() {
  if (!redoStack.length) return;
  const current = captureEditorState();
  const next = redoStack.pop();
  undoStack.push(current);
  restoreEditorState(next);
  setStatus("Redo");
}

function resetEditorHistory() {
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
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
  $("defaultTargetType").value = currentStage.targetType || currentStage.defaultTargetType || "Target";
  $("defaultTargetTypeCustom").value = currentStage.targetTypeCustom || currentStage.defaultTargetTypeCustom || "";
  $("targetNumberingEnabled").checked = !!(currentStage.targetNumbering && currentStage.targetNumbering.enabled);
  $("targetNumberingPrefix").value = (currentStage.targetNumbering && currentStage.targetNumbering.prefix) || "T";
  $("targetNumberingStart").value = (currentStage.targetNumbering && currentStage.targetNumbering.start) || 1;
  $("setupListAuto").checked = currentStage.setupListAuto !== false;
  $("setupListText").value = currentStage.setupListText || "";
  syncLightSettingsToForm();
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
  renderStageLightSettings();
  renderAmmoFields();
  renderMags("handgun");
  renderMags("longGun");
  calculateDifficulty();
  renderObjectForm();
  if (currentStage.setupListAuto) recalculateSetupList(false);
  applyTargetNumbering(false);
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
  currentStage.targetType = $("defaultTargetType").value || "Target";
  currentStage.targetTypeCustom = $("defaultTargetTypeCustom").value || "";
  currentStage.targetNumbering = {
    enabled: $("targetNumberingEnabled").checked,
    prefix: $("targetNumberingPrefix").value || "T",
    start: Math.max(1, Number($("targetNumberingStart").value || 1)),
    mode: "creation-order"
  };
  currentStage.setupListAuto = $("setupListAuto").checked;
  currentStage.setupListText = $("setupListText").value || "";
  readLightSettingsFromForm();
  const autoCalculate = $("ammoAutoCalculate").checked;
  const components = ammoComponents();
  const targetCount = components.baseTargets;
  const roundsPerTarget = Math.max(1, Number($("roundsPerTarget").value || 2));
  const rounds = autoCalculate ? Math.ceil(targetCount * roundsPerTarget + components.bonusShots) : Math.max(0, Number($("roundsPerRun").value || 0));
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
  renderStageLightSettings();
  renderAmmoFields();
  renderStageLightSettings();
  calculateDifficulty();
  if (currentStage.setupListAuto) recalculateSetupList(false);
  applyTargetNumbering(false);
  markDirty();
}

function renderWeaponDependent() {
  const w = currentStage.weaponType;
  $("handgunStartWrap").hidden = w === "langwaffe";
  $("longGunStartWrap").hidden = w === "kurzwaffe";
  $("handgunMagWrap").hidden = w === "langwaffe";
  $("longGunMagWrap").hidden = w === "kurzwaffe";
  $("manualDifficultyWrap").hidden = !$("difficultyOverrideEnabled").checked;
  $("defaultTargetTypeCustomWrap").hidden = $("defaultTargetType").value !== "Custom";
  $("setupListText").readOnly = $("setupListAuto").checked;
}

function hasLights() {
  return (currentStage.objects || []).some(obj => obj.type === "light");
}

function syncLightSettingsToForm() {
  currentStage.lightSettings = defaultLightProperties(currentStage.lightSettings || {});
  const light = currentStage.lightSettings;
  $("stageLightMode").value = light.mode;
  $("stageLightColor").value = light.color;
  $("stageLightDelay").value = light.delaySeconds.toFixed(1);
  $("stageLightTimeout").value = light.timeoutSeconds.toFixed(1);
  document.querySelectorAll("input[name='stageLightLimitType']").forEach(input => input.checked = input.value === light.limitType);
  $("stageLightTimer").value = light.timerValue;
  $("stageLightCounts").value = light.counts;
  $("stageLightSensorMode").checked = light.sensorMode;
  $("stageLightProbability").value = String(light.probability);
  renderStageLightLimitFields();
}

function readLightSettingsFromForm() {
  if (!$("stageLightMode")) return;
  currentStage.lightSettings = defaultLightProperties({
    mode: $("stageLightMode").value,
    color: $("stageLightColor").value,
    delaySeconds: $("stageLightDelay").value,
    timeoutSeconds: $("stageLightTimeout").value,
    limitType: (document.querySelector("input[name='stageLightLimitType']:checked") || {}).value,
    timerValue: $("stageLightTimer").value,
    counts: $("stageLightCounts").value,
    sensorMode: $("stageLightSensorMode").checked,
    probability: $("stageLightProbability").value
  });
}

function renderStageLightSettings() {
  const panel = $("lightSettingsPanel");
  if (!panel) return;
  panel.hidden = !hasLights();
  renderStageLightLimitFields();
}

function renderStageLightLimitFields() {
  if (!$("stageLightTimerWrap") || !$("stageLightCountsWrap")) return;
  const checked = document.querySelector("input[name='stageLightLimitType']:checked");
  const limitType = checked ? checked.value : "timer";
  $("stageLightTimerWrap").hidden = limitType !== "timer";
  $("stageLightCountsWrap").hidden = limitType !== "counts";
}

function normalizeAmmoState() {
  const components = ammoComponents();
  currentStage.ammo = {
    autoCalculate: currentStage.ammo.autoCalculate !== false,
    targetCount: components.baseTargets,
    roundsPerTarget: Math.max(1, Number(currentStage.ammo.roundsPerTarget || 2)),
    roundsPerRun: Math.max(0, Number(currentStage.ammo.roundsPerRun || 0)),
    runs: Math.max(1, Number(currentStage.ammo.runs || 1)),
    roundsPerShooterTotal: 0,
    manualAmmoNote: currentStage.ammo.manualAmmoNote || ""
  };
  if (currentStage.ammo.autoCalculate) {
    currentStage.ammo.roundsPerRun = Math.ceil(currentStage.ammo.targetCount * currentStage.ammo.roundsPerTarget + components.bonusShots);
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

function ammoComponents() {
  let baseTargets = 0;
  let bonusShots = 0;
  (currentStage.objects || []).forEach((obj) => {
    const variant = ((obj.properties || {}).targetVariant || "full");
    if ((obj.type === "target" || obj.type === "swinger" || obj.type === "mover") && variant !== "no-shoot") {
      baseTargets += 1;
      return;
    }
    if (obj.type === "popper") bonusShots += 1;
    if (obj.type === "steelPlate") bonusShots += 1;
    if (obj.type === "plateRack") bonusShots += 5;
  });
  return { baseTargets, bonusShots };
}

function countTargets() {
  return ammoComponents().baseTargets;
}

function stageTargetTypeLabel() {
  const selected = currentStage.targetType || currentStage.defaultTargetType || "Target";
  if (selected === "Custom") return currentStage.targetTypeCustom || currentStage.defaultTargetTypeCustom || "Custom";
  return selected;
}

function targetVariantLabel(obj, withDirection = false) {
  const props = obj.properties || {};
  const variant = props.targetVariant || "full";
  if (variant === "custom") return props.customTargetVariant || "Custom";
  const found = targetVariants.find(v => v.value === variant);
  const base = found ? found.label : "Voll";
  if (!withDirection || variant !== "half") return base;
  const dir = props.variantDirection || "right";
  const dirLabel = (variantDirections.find(d => d.value === dir) || variantDirections[1]).label.toLowerCase();
  return `${base} ${dirLabel}`;
}

function defaultLightProperties(existing = {}) {
  const color = lightColors.some(item => item.value === existing.color) ? existing.color : "#FF2A2A";
  const mode = lightModes.some(item => item.value === existing.mode) ? existing.mode : "color";
  const limitType = existing.limitType === "counts" ? "counts" : "timer";
  const timerValue = lightTimerSteps.some(item => item.value === String(existing.timerValue)) ? String(existing.timerValue) : "infinite";
  const rawProbability = existing.probability == null ? 100 : existing.probability;
  const probability = Math.max(0, Math.min(100, Math.round(Number(rawProbability) / 10) * 10));
  return {
    mode,
    color,
    delaySeconds: round1(Math.max(0, Number(existing.delaySeconds || 0))),
    timeoutSeconds: round1(Math.max(0, Number(existing.timeoutSeconds || 0))),
    limitType,
    timerValue,
    counts: Math.max(1, Math.round(Number(existing.counts || 1))),
    sensorMode: !!existing.sensorMode,
    probability
  };
}

function lightColor(obj) {
  return defaultLightProperties(currentStage.lightSettings || (obj && obj.properties) || {}).color;
}

function defaultStructureProperties(type, existing = {}) {
  if (type === "window") {
    return normalizeWindowProperties({ openingWidthM: 1.0, openingPosition: "center", openingOffsetM: null, ...existing }, 2.0);
  }
  if (type === "door") {
    return normalizeDoorProperties({
      doorWidthM: 0.9,
      doorPosition: "center",
      openingOffsetM: null,
      hingeSide: "left",
      swingDirection: "in",
      openAngle: 90,
      ...existing
    }, 2.0);
  }
  return {};
}

function normalizeOpeningWidth(value, lengthM) {
  return Math.max(.1, Math.min(Number(value || 1), Math.max(.1, Number(lengthM || 1))));
}

function normalizeOpeningOffset(value, openingWidthM, lengthM) {
  const maxOffset = Math.max(0, Number(lengthM || 0) - Number(openingWidthM || 0));
  return round2(clamp(Number(value || 0), 0, maxOffset));
}

function normalizeWindowProperties(props, lengthM) {
  const openingWidthM = normalizeOpeningWidth(props.openingWidthM, lengthM);
  const position = ["center", "left", "right", "free"].includes(props.openingPosition) ? props.openingPosition : "center";
  return {
    openingWidthM,
    openingPosition: position,
    openingOffsetM: position === "free" ? normalizeOpeningOffset(props.openingOffsetM, openingWidthM, lengthM) : null
  };
}

function normalizeDoorProperties(props, lengthM) {
  const doorWidthM = normalizeOpeningWidth(props.doorWidthM, lengthM);
  const position = ["center", "left", "right", "free"].includes(props.doorPosition) ? props.doorPosition : "center";
  const angle = [45, 90, 120].includes(Number(props.openAngle)) ? Number(props.openAngle) : 90;
  return {
    doorWidthM,
    doorPosition: position,
    openingOffsetM: position === "free" ? normalizeOpeningOffset(props.openingOffsetM, doorWidthM, lengthM) : null,
    hingeSide: props.hingeSide === "right" ? "right" : "left",
    swingDirection: props.swingDirection === "out" ? "out" : "in",
    openAngle: angle
  };
}

function openingStart(lengthM, openingWidthM, position, offsetM) {
  const maxStart = Math.max(0, Number(lengthM || 0) - Number(openingWidthM || 0));
  if (position === "left") return 0;
  if (position === "right") return maxStart;
  if (position === "free") return normalizeOpeningOffset(offsetM, openingWidthM, lengthM);
  return round2(maxStart / 2);
}

function getOpeningSegments(lengthM, openingWidthM, position, offsetM) {
  const start = openingStart(lengthM, openingWidthM, position, offsetM);
  const end = start + openingWidthM;
  return {
    openingStartM: start,
    openingEndM: end,
    leftM: Math.max(0, start),
    rightStartM: Math.min(lengthM, end),
    rightM: Math.max(0, lengthM - end)
  };
}

function applyTargetNumbering(force) {
  if (!currentStage.targetNumbering || !currentStage.targetNumbering.enabled) return;
  let index = Math.max(1, Number(currentStage.targetNumbering.start || 1));
  const prefix = currentStage.targetNumbering.prefix || "T";
  (currentStage.objects || []).forEach(obj => {
    if (obj.type !== "target") return;
    const autoPrefix = `${prefix}`;
    const shouldUpdate = force || !obj.label || obj.label.startsWith(autoPrefix);
    if (shouldUpdate) obj.label = `${prefix}${index}`;
    index += 1;
  });
}

function recalculateSetupList(overwriteText) {
  const counts = new Map();
  const stageType = stageTargetTypeLabel();
  (currentStage.objects || []).forEach(obj => {
    if (obj.type === "note") return;
    if (obj.type === "arrow") return;
    if (obj.type === "target") {
      const variant = (obj.properties && obj.properties.targetVariant) || "full";
      const key = variant === "full"
        ? `${stageType}`
        : variant === "no-shoot"
          ? `${stageType}, No-Shoot`
          : `${stageType}, ${targetVariantLabel(obj, true)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return;
    }
    if (obj.type === "swinger" || obj.type === "mover") {
      const variant = (obj.properties && obj.properties.targetVariant) || "full";
      const base = (objectTypes[obj.type] && objectTypes[obj.type].label) || obj.type;
      const key = variant === "full" ? base : `${base}, ${targetVariantLabel(obj, true)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return;
    }
    const name = (objectTypes[obj.type] && objectTypes[obj.type].label) || obj.type;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const lines = [...counts.entries()].map(([label, count]) => `${count}x ${label}`);
  const text = lines.join("\n");
  if (overwriteText || $("setupListAuto").checked) {
    $("setupListText").value = text;
    currentStage.setupListText = text;
  }
}

function calculateDifficulty() {
  const focus = new Set(currentStage.focusAreas);
  const objects = currentStage.objects || [];
  const targetCount = objects.filter(obj => obj.type === "target").length;
  const noShootCount = objects.filter(obj => obj.type === "target" && ((obj.properties || {}).targetVariant || "full") === "no-shoot").length;
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
    updateObjectActionBar();
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
  ordered.filter(obj => !selectedObjectIds.has(obj.id)).forEach(obj => svg.append(objectNode(obj)));
  const selectedList = selectedObjects();
  selectedList.forEach(obj => svg.append(objectNode(obj)));
  ordered.forEach(obj => {
    if (obj.label) svg.append(labelNode(obj));
  });
  alignmentGuides.forEach(guide => svg.append(alignmentGuideNode(guide, width, height)));
  selectedList.forEach(obj => svg.append(selectionNode(obj)));
  updateObjectActionBar();
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
  const classes = ["stage-object"];
  if (obj.locked) classes.push("locked");
  if (selectedObjectIds.has(obj.id)) classes.push("selected");
  const g = el("g", { class: classes.join(" "), transform: `rotate(${obj.rotation || 0} ${box.cx} ${box.cy})` });
  appendObjectSymbol(g, obj, box);
  if (obj.locked) {
    g.append(el("text", { x: box.x + box.w + .08, y: box.y + .18, class: "lock-mark" }, "LOCK"));
  }
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

function alignmentGuideNode(guide, width, height) {
  if (guide.axis === "x") {
    return el("line", { x1: guide.value, y1: 0, x2: guide.value, y2: height, class: "alignment-guide" });
  }
  return el("line", { x1: 0, y1: guide.value, x2: width, y2: guide.value, class: "alignment-guide" });
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
    const minM = structureTypes.has(obj.type) ? 0.02 : Math.max(.22, 20 / ppm);
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
    const variant = ((obj.properties || {}).targetVariant || "full");
    const isNoShoot = variant === "no-shoot";
    const targetStroke = isNoShoot ? "#dc2626" : stroke;
    const targetFill = isNoShoot ? "#f8fafc" : theme.fill;
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .04, fill: targetFill, stroke: targetStroke, "stroke-width": isNoShoot ? .05 : .04 }));
    if (!isNoShoot) {
      g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .32, class: "symbol-mark" }));
      g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .14, class: "symbol-mark" }));
    }
    appendTargetVariantOverlay(g, obj, b, "target");
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
  } else if (obj.type === "wall") {
    drawWallSvg(g, b, theme);
  } else if (obj.type === "window") {
    drawWindowSvg(g, obj, b, theme);
  } else if (obj.type === "door") {
    drawDoorSvg(g, obj, b, theme);
  } else if (obj.type === "light") {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .08, fill: lightColor(obj), stroke, "stroke-width": .04 }));
    g.append(el("polygon", { points: `${b.cx},${b.y + b.h * .12} ${b.x + b.w * .36},${b.cy} ${b.cx},${b.cy} ${b.x + b.w * .42},${b.y + b.h * .88} ${b.x + b.w * .68},${b.y + b.h * .42} ${b.cx},${b.y + b.h * .42}`, fill: "#111827", stroke: "#111827", "stroke-width": .01 }));
  } else if (obj.type === "arrow") {
    g.append(el("polygon", { points: `${b.x},${b.y + b.h * .34} ${b.x + b.w * .58},${b.y + b.h * .34} ${b.x + b.w * .58},${b.y + b.h * .14} ${b.x + b.w},${b.cy} ${b.x + b.w * .58},${b.y + b.h * .86} ${b.x + b.w * .58},${b.y + b.h * .66} ${b.x},${b.y + b.h * .66}`, fill: theme.fill, stroke, "stroke-width": .04 }));
  } else if (obj.type === "popper") {
    g.append(el("polygon", { points: `${b.cx},${b.y} ${b.x + b.w * .72},${b.y + b.h * .2} ${b.x + b.w * .76},${b.y + b.h * .6} ${b.x + b.w * .64},${b.y + b.h * .84} ${b.x + b.w * .36},${b.y + b.h * .84} ${b.x + b.w * .24},${b.y + b.h * .6} ${b.x + b.w * .28},${b.y + b.h * .2}`, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("rect", { x: b.x + b.w * .42, y: b.y + b.h * .84, width: b.w * .16, height: b.h * .12, fill: theme.fill, stroke, "stroke-width": .04 }));
  } else if (obj.type === "steelPlate") {
    g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .48, fill: theme.fill, stroke, "stroke-width": .06 }));
  } else if (obj.type === "swinger") {
    const variant = ((obj.properties || {}).targetVariant || "full");
    const swingerFill = variant === "no-shoot" ? "#f8fafc" : theme.fill;
    g.append(el("rect", { x: b.x + b.w * .24, y: b.y + b.h * .14, width: b.w * .52, height: b.h * .66, rx: .04, fill: swingerFill, stroke, "stroke-width": .06 }));
    g.append(el("rect", { x: b.cx - b.w * .08, y: b.y + b.h * .78, width: b.w * .16, height: b.h * .12, rx: .02, fill: "#111827" }));
    g.append(el("path", { d: `M ${b.x + b.w * .22} ${b.y + b.h * .58} Q ${b.x + b.w * .12} ${b.y + b.h * .5} ${b.x + b.w * .22} ${b.y + b.h * .42}`, fill: "none", stroke: "#111827", "stroke-width": .06 }));
    g.append(el("polygon", { points: `${b.x + b.w * .2},${b.y + b.h * .42} ${b.x + b.w * .25},${b.y + b.h * .43} ${b.x + b.w * .22},${b.y + b.h * .47}`, fill: "#111827" }));
    g.append(el("path", { d: `M ${b.x + b.w * .78} ${b.y + b.h * .42} Q ${b.x + b.w * .88} ${b.y + b.h * .5} ${b.x + b.w * .78} ${b.y + b.h * .58}`, fill: "none", stroke: "#111827", "stroke-width": .06 }));
    g.append(el("polygon", { points: `${b.x + b.w * .8},${b.y + b.h * .58} ${b.x + b.w * .75},${b.y + b.h * .57} ${b.x + b.w * .78},${b.y + b.h * .53}`, fill: "#111827" }));
    appendTargetVariantOverlay(g, obj, b, "swinger");
  } else if (obj.type === "mover") {
    const variant = ((obj.properties || {}).targetVariant || "full");
    const moverFill = variant === "no-shoot" ? "#f8fafc" : theme.fill;
    g.append(el("rect", { x: b.x + b.w * .24, y: b.y + b.h * .14, width: b.w * .52, height: b.h * .66, rx: .04, fill: moverFill, stroke, "stroke-width": .06 }));
    g.append(el("line", { x1: b.x + b.w * .16, y1: b.y + b.h * .82, x2: b.x + b.w * .84, y2: b.y + b.h * .82, stroke: "#111827", "stroke-width": .06 }));
    g.append(el("line", { x1: b.x + b.w * .22, y1: b.y + b.h * .9, x2: b.x + b.w * .78, y2: b.y + b.h * .9, stroke: "#111827", "stroke-width": .06 }));
    g.append(el("polygon", { points: `${b.x + b.w * .22},${b.y + b.h * .9} ${b.x + b.w * .29},${b.y + b.h * .86} ${b.x + b.w * .29},${b.y + b.h * .94}`, fill: "#111827" }));
    g.append(el("polygon", { points: `${b.x + b.w * .78},${b.y + b.h * .9} ${b.x + b.w * .71},${b.y + b.h * .86} ${b.x + b.w * .71},${b.y + b.h * .94}`, fill: "#111827" }));
    appendTargetVariantOverlay(g, obj, b, "mover");
  } else if (obj.type === "plateRack") {
    for (let i = 0; i < 5; i++) g.append(el("circle", { cx: b.x + b.w * (.14 + i * .18), cy: b.y + b.h * .48, r: Math.min(b.w, b.h) * .18, fill: theme.fill, stroke, "stroke-width": .06 }));
    g.append(el("line", { x1: b.x + b.w * .06, y1: b.y + b.h * .82, x2: b.x + b.w * .94, y2: b.y + b.h * .82, stroke: "#111827", "stroke-width": .06 }));
  } else if (obj.type === "activator") {
    g.append(el("rect", { x: b.x + b.w * .2, y: b.y + b.h * .12, width: b.w * .6, height: b.h * .76, rx: .06, fill: theme.fill, stroke, "stroke-width": .04 }));
    g.append(el("polygon", { points: `${b.cx},${b.y + b.h * .2} ${b.x + b.w * .42},${b.cy} ${b.cx},${b.cy} ${b.x + b.w * .56},${b.y + b.h * .82} ${b.x + b.w * .68},${b.y + b.h * .5} ${b.cx},${b.y + b.h * .5}`, fill: "#111827", stroke: "#111827", "stroke-width": .01 }));
  } else {
    g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .05, fill: theme.fill, stroke, "stroke-width": .04 }));
    if (obj.type === "backstop") {
      g.append(el("polygon", { points: `${b.x + b.w * .08},${b.y + b.h * .15} ${b.x + b.w * .92},${b.y + b.h * .15} ${b.x + b.w * .82},${b.y + b.h * .85} ${b.x + b.w * .18},${b.y + b.h * .85}`, fill: theme.fill, stroke, "stroke-width": .04 }));
      g.append(el("line", { x1: b.x + b.w * .26, y1: b.cy, x2: b.x + b.w * .74, y2: b.cy, stroke: theme.accent, "stroke-width": .04 }));
    }
    if (obj.type === "note") g.append(el("text", { x: b.x + b.w * .18, y: b.y + b.h * .62, "font-size": Math.min(b.w, b.h) * .55, fill: "#111827" }, "T"));
    if (obj.type === "marker") g.append(el("circle", { cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) * .28, class: "symbol-mark" }));
  }
}

function drawWallSvg(g, b, theme) {
  g.append(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: .015, fill: theme.fill, stroke: theme.stroke, "stroke-width": .045 }));
}

function addWallSegmentSvg(g, x, y, w, h, theme) {
  if (w <= 0) return;
  g.append(el("rect", { x, y, width: w, height: h, rx: .01, fill: theme.fill, stroke: theme.stroke, "stroke-width": .045 }));
}

function drawWindowSvg(g, obj, b, theme) {
  const props = normalizeWindowProperties(obj.properties || {}, obj.widthM);
  const seg = getOpeningSegments(Number(obj.widthM), props.openingWidthM, props.openingPosition, props.openingOffsetM);
  const scaleX = b.w / Number(obj.widthM || 1);
  const openX = b.x + seg.openingStartM * scaleX;
  const openW = props.openingWidthM * scaleX;
  addWallSegmentSvg(g, b.x, b.y, seg.leftM * scaleX, b.h, theme);
  addWallSegmentSvg(g, b.x + seg.rightStartM * scaleX, b.y, seg.rightM * scaleX, b.h, theme);
  g.append(el("rect", { x: openX, y: b.y, width: openW, height: b.h, fill: theme.accent || "#dbeafe", stroke: theme.stroke, "stroke-width": .035 }));
  g.append(el("line", { x1: openX, y1: b.cy, x2: openX + openW, y2: b.cy, stroke: "#60a5fa", "stroke-width": .035 }));
}

function drawDoorSvg(g, obj, b, theme) {
  const props = normalizeDoorProperties(obj.properties || {}, obj.widthM);
  const seg = getOpeningSegments(Number(obj.widthM), props.doorWidthM, props.doorPosition, props.openingOffsetM);
  const scaleX = b.w / Number(obj.widthM || 1);
  const openX = b.x + seg.openingStartM * scaleX;
  const openW = props.doorWidthM * scaleX;
  addWallSegmentSvg(g, b.x, b.y, seg.leftM * scaleX, b.h, theme);
  addWallSegmentSvg(g, b.x + seg.rightStartM * scaleX, b.y, seg.rightM * scaleX, b.h, theme);

  const hingeX = props.hingeSide === "left" ? openX : openX + openW;
  const hingeY = b.cy;
  const side = props.swingDirection === "in" ? 1 : -1;
  const angle = props.openAngle * Math.PI / 180;
  const theta = props.hingeSide === "left" ? side * angle : Math.PI - side * angle;
  const endX = hingeX + Math.cos(theta) * openW;
  const endY = hingeY + Math.sin(theta) * openW;
  const closedX = hingeX + (props.hingeSide === "left" ? openW : -openW);
  const sweep = props.hingeSide === "left" ? (side > 0 ? 1 : 0) : (side > 0 ? 0 : 1);
  g.append(el("line", { x1: hingeX, y1: hingeY, x2: endX, y2: endY, stroke: theme.stroke, "stroke-width": .045 }));
  g.append(el("path", { d: `M ${closedX} ${hingeY} A ${openW} ${openW} 0 0 ${sweep} ${endX} ${endY}`, fill: "none", stroke: theme.stroke, "stroke-width": .03 }));
  g.append(el("circle", { cx: hingeX, cy: hingeY, r: Math.max(.035, b.h * .18), fill: theme.stroke }));
}

function variantFrame(type, b) {
  if (type === "swinger") return { x: b.x + b.w * .24, y: b.y + b.h * .14, w: b.w * .52, h: b.h * .66 };
  if (type === "mover") return { x: b.x + b.w * .24, y: b.y + b.h * .14, w: b.w * .52, h: b.h * .66 };
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

function appendTargetVariantOverlay(g, obj, b, type = "target") {
  const props = obj.properties || {};
  const variant = props.targetVariant || "full";
  const direction = props.variantDirection || "right";
  const frame = variantFrame(type, b);
  const mask = "#f8fafc";
  if (variant === "half") {
    const ov = direction === "left"
      ? { x: frame.x + frame.w * .5, y: frame.y, w: frame.w * .5, h: frame.h }
      : direction === "right"
        ? { x: frame.x, y: frame.y, w: frame.w * .5, h: frame.h }
        : direction === "top"
          ? { x: frame.x, y: frame.y + frame.h * .5, w: frame.w, h: frame.h * .5 }
          : { x: frame.x, y: frame.y, w: frame.w, h: frame.h * .5 };
    g.append(el("rect", { x: ov.x, y: ov.y, width: ov.w, height: ov.h, fill: mask, stroke: "none" }));
  } else if (variant === "head-only") {
    g.append(el("rect", { x: frame.x, y: frame.y + frame.h * .34, width: frame.w, height: frame.h * .66, fill: mask, stroke: "none" }));
  }
  if (variant === "no-shoot") {
    g.append(el("line", { x1: frame.x, y1: frame.y, x2: frame.x + frame.w, y2: frame.y + frame.h, class: "symbol-red" }));
    g.append(el("line", { x1: frame.x + frame.w, y1: frame.y, x2: frame.x, y2: frame.y + frame.h, class: "symbol-red" }));
  }
}

function colorFor(type) {
  return (symbolTheme[type] && symbolTheme[type].fill) || "#93c5fd";
}

function addObject(type) {
  if (hiddenObjectTypes.has(type)) return;
  if (!activeRange) return setStatus("Bitte zuerst einen Schiesskeller wählen", true);
  pushUndoState();
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
    locked: false,
    properties: {}
  };
  if (["target", "swinger", "mover"].includes(type)) {
    obj.properties = {
      targetVariant: "full",
      variantDirection: "right",
      customTargetVariant: "",
      targetNote: ""
    };
  } else if (structureTypes.has(type)) {
    obj.properties = defaultStructureProperties(type);
  }
  applyCenterBounds(obj);
  currentStage.objects.push(obj);
  if (type === "target") applyTargetNumbering(false);
  selectedObjectId = obj.id;
  selectedObjectIds = new Set([obj.id]);
  renderAmmoFields();
  renderStageLightSettings();
  calculateDifficulty();
  if (currentStage.setupListAuto) recalculateSetupList(true);
  renderStage();
  renderObjectForm();
  markDirty();
}

function startDrag(event, id) {
  event.preventDefault();
  const clicked = currentStage.objects.find(o => o.id === id);
  if (!clicked) return;
  if (event.shiftKey || event.metaKey) {
    if (selectedObjectIds.has(id)) {
      selectedObjectIds.delete(id);
      if (selectedObjectId === id) selectedObjectId = [...selectedObjectIds][0] || null;
    } else {
      selectedObjectIds.add(id);
      selectedObjectId = id;
    }
    activateTab("object");
    renderStage();
    renderObjectForm();
    return;
  }
  if (!selectedObjectIds.has(id)) selectedObjectIds = new Set([id]);
  selectedObjectId = id;
  const obj = selectedObject();
  if (!obj || obj.locked) {
    activateTab("object");
    renderStage();
    renderObjectForm();
    return;
  }
  const p = svgPoint(event);
  const selected = selectedObjects().filter(item => !item.locked);
  dragState = {
    id,
    startPoint: p,
    before: captureEditorState(),
    objects: selected.map(item => ({ id: item.id, xM: item.xM, yM: item.yM }))
  };
  activateTab("object");
  renderStage();
  renderObjectForm();
  updateObjectActionBar();
}

function onPointerMove(event) {
  if (!dragState || !activeRange) return;
  const p = svgPoint(event);
  const rawDx = p.x - dragState.startPoint.x;
  const rawDy = p.y - dragState.startPoint.y;
  const snapped = snappedDelta(dragState.objects, rawDx, rawDy);
  dragState.objects.forEach(start => {
    const obj = currentStage.objects.find(item => item.id === start.id);
    if (!obj || obj.locked) return;
    obj.xM = round2(start.xM + snapped.dx);
    obj.yM = round2(start.yM + snapped.dy);
    applyCenterBounds(obj);
  });
  renderStage();
  renderObjectForm();
  markDirty();
}

function endDrag() {
  if (!dragState) return;
  const before = dragState.before;
  dragState = null;
  alignmentGuides = [];
  const after = captureEditorState();
  if (!statesEqual(before, after)) pushUndoState(before);
  renderStage();
}

function svgPoint(event) {
  const svg = $("stageSvg");
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function snapValue(value, candidates) {
  let best = { value, matched: null, distance: SNAP_THRESHOLD_M };
  candidates.forEach(candidate => {
    const distance = Math.abs(value - candidate);
    if (distance <= best.distance) best = { value: candidate, matched: candidate, distance };
  });
  return best;
}

function objectSnapPoints(obj, dx = 0, dy = 0) {
  const x = Number(obj.xM || 0) + dx;
  const y = Number(obj.yM || 0) + dy;
  const w = Number(obj.widthM || 0);
  const h = Number(obj.heightM || 0);
  return {
    x: [x, x + w / 2, x + w],
    y: [y, y + h / 2, y + h]
  };
}

function gridCandidates(max) {
  const step = Math.max(.1, Number(activeRange.gridM || 1));
  const values = [];
  for (let value = 0; value <= max + .001; value += step) values.push(round2(value));
  return values;
}

function snappedDelta(starts, dx, dy) {
  alignmentGuides = [];
  if (!snapEnabled || !activeRange || !starts.length) return { dx, dy };
  const movingIds = new Set(starts.map(item => item.id));
  const staticObjects = (currentStage.objects || []).filter(obj => !movingIds.has(obj.id));
  const candidatesX = gridCandidates(activeRange.widthM);
  const candidatesY = gridCandidates(activeRange.heightM);
  staticObjects.forEach(obj => {
    const points = objectSnapPoints(obj);
    candidatesX.push(...points.x);
    candidatesY.push(...points.y);
  });

  let bestX = { distance: SNAP_THRESHOLD_M, delta: dx, guide: null };
  let bestY = { distance: SNAP_THRESHOLD_M, delta: dy, guide: null };
  starts.forEach(start => {
    const obj = currentStage.objects.find(item => item.id === start.id);
    if (!obj) return;
    const ghost = { ...obj, xM: start.xM, yM: start.yM };
    const points = objectSnapPoints(ghost, dx, dy);
    points.x.forEach(point => {
      const snap = snapValue(point, candidatesX);
      if (snap.matched !== null && snap.distance <= bestX.distance) {
        bestX = { distance: snap.distance, delta: dx + snap.matched - point, guide: snap.matched };
      }
    });
    points.y.forEach(point => {
      const snap = snapValue(point, candidatesY);
      if (snap.matched !== null && snap.distance <= bestY.distance) {
        bestY = { distance: snap.distance, delta: dy + snap.matched - point, guide: snap.matched };
      }
    });
  });
  if (bestX.guide !== null) alignmentGuides.push({ axis: "x", value: bestX.guide });
  if (bestY.guide !== null) alignmentGuides.push({ axis: "y", value: bestY.guide });
  return { dx: bestX.delta, dy: bestY.delta };
}

function selectedObject() {
  return currentStage.objects.find(o => o.id === selectedObjectId);
}

function selectedObjects() {
  return (currentStage.objects || []).filter(o => selectedObjectIds.has(o.id));
}

function ensureSelection(id) {
  selectedObjectId = id || null;
  selectedObjectIds = id ? new Set([id]) : new Set();
}

function renderObjectForm() {
  const obj = selectedObject();
  if (!obj) {
    $("objectForm").className = "object-form muted";
    $("objectForm").textContent = "Kein Objekt ausgewählt";
    return;
  }
  const hasTargetVariant = ["target", "swinger", "mover"].includes(obj.type);
  const isStructure = structureTypes.has(obj.type);
  const isWindow = obj.type === "window";
  const isDoor = obj.type === "door";
  const typeOptions = Object.entries(objectTypes)
    .filter(([k]) => !hiddenObjectTypes.has(k) || k === obj.type)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
    .join("");
  const props = obj.properties || {};
  $("objectForm").className = "object-form";
  $("objectForm").innerHTML = `
    <div class="object-actions object-actions-panel">
      <button id="objRotateLeft" type="button">-15°</button>
      <button id="objRotateRight" type="button">+15°</button>
      <button id="objDuplicate" type="button">Duplizieren</button>
      <button id="objDelete" type="button">Löschen</button>
    </div>
    <label class="check-row"><input id="objLocked" type="checkbox"> Objekt sperren</label>
    <label>Typ<select id="objType">${typeOptions}</select></label>
    <div class="muted">X/Y beziehen sich auf die Objektmitte</div>
    <div class="grid2">
      <label>X Position Mitte m<input id="objX" type="number" step="0.1"></label>
      <label>Y Position Mitte m<input id="objY" type="number" step="0.1"></label>
      <label>${isStructure ? "Länge m" : "Breite m"}<input id="objW" type="number" step="0.1" min="0.02"></label>
      <label>${isStructure ? "Dicke m" : "Höhe/Tiefe m"}<input id="objH" type="number" step="0.01" min="0.02"></label>
      <label>Rotation °<input id="objRot" type="number" step="5"></label>
      <label>Label<input id="objLabel"></label>
    </div>
    ${isWindow ? `
    <section class="object-subpanel">
      <h3>Fenster</h3>
      <label>Fensterbreite m<input id="objOpeningWidth" type="number" min="0.1" step="0.1"></label>
      <label>Fensterposition<select id="objOpeningPosition">
        <option value="center">Mitte</option>
        <option value="left">Links</option>
        <option value="right">Rechts</option>
        <option value="free">Frei</option>
      </select></label>
      <label id="objOpeningOffsetWrap">Öffnung Abstand von links m<input id="objOpeningOffset" type="number" min="0" step="0.1"></label>
    </section>
    ` : ""}
    ${isDoor ? `
    <section class="object-subpanel">
      <h3>Tür</h3>
      <label>Türbreite m<input id="objDoorWidth" type="number" min="0.1" step="0.1"></label>
      <label>Türposition<select id="objDoorPosition">
        <option value="center">Mitte</option>
        <option value="left">Links</option>
        <option value="right">Rechts</option>
        <option value="free">Frei</option>
      </select></label>
      <label id="objDoorOffsetWrap">Öffnung Abstand von links m<input id="objDoorOffset" type="number" min="0" step="0.1"></label>
      <label>Türseite / Anschlag<select id="objHingeSide">
        <option value="left">links angeschlagen</option>
        <option value="right">rechts angeschlagen</option>
      </select></label>
      <label>Öffnungsrichtung<select id="objSwingDirection">
        <option value="in">nach innen</option>
        <option value="out">nach aussen</option>
      </select></label>
      <label>Öffnungswinkel<select id="objOpenAngle">
        <option value="45">45°</option>
        <option value="90">90°</option>
        <option value="120">120°</option>
      </select></label>
    </section>
    ` : ""}
    ${hasTargetVariant ? `
    <label>Scheibenvariante<select id="objTargetVariant">
      ${targetVariants.map(v => `<option value="${v.value}">${v.label}</option>`).join("")}
    </select></label>
    <label id="objVariantDirectionWrap">Richtung<select id="objVariantDirection">
      ${variantDirections.map(v => `<option value="${v.value}">${v.label}</option>`).join("")}
    </select></label>
    <label id="objTargetVariantCustomWrap">Custom Variant Text<input id="objTargetVariantCustom"></label>
    <label>Zielnotiz<textarea id="objTargetNote" rows="2"></textarea></label>
    ` : ""}
    ${obj.type === "light" ? `<div class="object-subpanel muted">Licht-Einstellungen gelten für alle Lichter dieser Stage.</div>` : ""}`;
  const center = objectCenterM(obj);
  $("objType").value = obj.type; $("objX").value = round2(center.x); $("objY").value = round2(center.y);
  $("objW").value = obj.widthM; $("objH").value = obj.heightM; $("objRot").value = obj.rotation; $("objLabel").value = obj.label || "";
  $("objLocked").checked = !!obj.locked;
  if (isWindow) {
    const win = normalizeWindowProperties(props, obj.widthM);
    $("objOpeningWidth").value = win.openingWidthM;
    $("objOpeningPosition").value = win.openingPosition;
    $("objOpeningOffset").value = win.openingOffsetM || 0;
    $("objOpeningOffsetWrap").hidden = win.openingPosition !== "free";
    $("objOpeningPosition").addEventListener("input", () => {
      $("objOpeningOffsetWrap").hidden = $("objOpeningPosition").value !== "free";
      readObjectForm();
    });
  }
  if (isDoor) {
    const door = normalizeDoorProperties(props, obj.widthM);
    $("objDoorWidth").value = door.doorWidthM;
    $("objDoorPosition").value = door.doorPosition;
    $("objDoorOffset").value = door.openingOffsetM || 0;
    $("objDoorOffsetWrap").hidden = door.doorPosition !== "free";
    $("objHingeSide").value = door.hingeSide;
    $("objSwingDirection").value = door.swingDirection;
    $("objOpenAngle").value = String(door.openAngle);
    $("objDoorPosition").addEventListener("input", () => {
      $("objDoorOffsetWrap").hidden = $("objDoorPosition").value !== "free";
      readObjectForm();
    });
  }
  if (hasTargetVariant) {
    $("objTargetVariant").value = props.targetVariant || "full";
    $("objVariantDirection").value = props.variantDirection || "right";
    $("objTargetVariantCustom").value = props.customTargetVariant || "";
    $("objTargetNote").value = props.targetNote || "";
    $("objVariantDirectionWrap").hidden = $("objTargetVariant").value !== "half";
    $("objTargetVariantCustomWrap").hidden = $("objTargetVariant").value !== "custom";
    $("objTargetVariant").addEventListener("input", () => {
      $("objTargetVariantCustomWrap").hidden = $("objTargetVariant").value !== "custom";
      $("objVariantDirectionWrap").hidden = $("objTargetVariant").value !== "half";
      readObjectForm();
    });
  }
  $("objRotateLeft").addEventListener("click", () => rotateSelectedObject(-15));
  $("objRotateRight").addEventListener("click", () => rotateSelectedObject(15));
  $("objDuplicate").addEventListener("click", duplicateSelectedObject);
  $("objDelete").addEventListener("click", deleteSelectedObject);
  $("objLocked").addEventListener("change", readObjectForm);
  ["objType", "objX", "objY", "objW", "objH", "objRot", "objLabel"].forEach(id => {
    $(id).addEventListener("focus", beginObjectFormEdit);
    $(id).addEventListener("input", readObjectForm);
  });
  if (hasTargetVariant) ["objVariantDirection", "objTargetVariantCustom", "objTargetNote"].forEach(id => $(id).addEventListener("input", readObjectForm));
  if (isWindow) ["objOpeningWidth", "objOpeningOffset"].forEach(id => $(id).addEventListener("input", readObjectForm));
  if (isDoor) ["objDoorWidth", "objDoorOffset", "objHingeSide", "objSwingDirection", "objOpenAngle"].forEach(id => $(id).addEventListener("input", readObjectForm));
  updateObjectActionBar();
}

function beginObjectFormEdit() {
  if (!pendingObjectFormSnapshot) pendingObjectFormSnapshot = captureEditorState();
}

function scheduleObjectFormHistoryCommit() {
  if (objectFormHistoryTimer) clearTimeout(objectFormHistoryTimer);
  objectFormHistoryTimer = setTimeout(commitObjectFormHistory, 450);
}

function commitObjectFormHistory() {
  if (!pendingObjectFormSnapshot) return;
  const before = pendingObjectFormSnapshot;
  pendingObjectFormSnapshot = null;
  objectFormHistoryTimer = null;
  if (!statesEqual(before, captureEditorState())) pushUndoState(before);
}

function readObjectForm() {
  const obj = selectedObject();
  if (!obj) return;
  if (!pendingObjectFormSnapshot) pendingObjectFormSnapshot = captureEditorState();
  obj.type = $("objType").value;
  obj.properties = obj.properties || {};
  obj.locked = $("objLocked").checked;
  obj.widthM = Math.max(.02, Number($("objW").value || .02));
  obj.heightM = Math.max(.02, Number($("objH").value || .02));
  const centerX = Number($("objX").value || 0);
  const centerY = Number($("objY").value || 0);
  obj.xM = centerX - obj.widthM / 2;
  obj.yM = centerY - obj.heightM / 2;
  applyCenterBounds(obj);
  obj.rotation = Number($("objRot").value || 0);
  obj.label = $("objLabel").value;
  if (["target", "swinger", "mover"].includes(obj.type)) {
    obj.properties.targetVariant = $("objTargetVariant") ? $("objTargetVariant").value : (obj.properties.targetVariant || "full");
    obj.properties.variantDirection = $("objVariantDirection") ? $("objVariantDirection").value : (obj.properties.variantDirection || "right");
    obj.properties.customTargetVariant = $("objTargetVariantCustom") ? $("objTargetVariantCustom").value : (obj.properties.customTargetVariant || "");
    obj.properties.targetNote = $("objTargetNote") ? $("objTargetNote").value : (obj.properties.targetNote || "");
  } else if (obj.type === "window") {
    obj.properties = normalizeWindowProperties({
      openingWidthM: $("objOpeningWidth") ? $("objOpeningWidth").value : obj.properties.openingWidthM,
      openingPosition: $("objOpeningPosition") ? $("objOpeningPosition").value : obj.properties.openingPosition,
      openingOffsetM: $("objOpeningOffset") ? $("objOpeningOffset").value : obj.properties.openingOffsetM
    }, obj.widthM);
    if ($("objOpeningOffsetWrap")) $("objOpeningOffsetWrap").hidden = obj.properties.openingPosition !== "free";
  } else if (obj.type === "door") {
    obj.properties = normalizeDoorProperties({
      doorWidthM: $("objDoorWidth") ? $("objDoorWidth").value : obj.properties.doorWidthM,
      doorPosition: $("objDoorPosition") ? $("objDoorPosition").value : obj.properties.doorPosition,
      openingOffsetM: $("objDoorOffset") ? $("objDoorOffset").value : obj.properties.openingOffsetM,
      hingeSide: $("objHingeSide") ? $("objHingeSide").value : obj.properties.hingeSide,
      swingDirection: $("objSwingDirection") ? $("objSwingDirection").value : obj.properties.swingDirection,
      openAngle: $("objOpenAngle") ? $("objOpenAngle").value : obj.properties.openAngle
    }, obj.widthM);
    if ($("objDoorOffsetWrap")) $("objDoorOffsetWrap").hidden = obj.properties.doorPosition !== "free";
  }
  if (currentStage.setupListAuto) recalculateSetupList(true);
  renderStage();
  markDirty();
  scheduleObjectFormHistoryCommit();
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
  const ids = new Set(selectedObjects().filter(obj => !obj.locked).map(obj => obj.id));
  if (!ids.size) return;
  pushUndoState();
  currentStage.objects = currentStage.objects.filter(o => !ids.has(o.id));
  ensureSelection(null);
  renderAmmoFields();
  renderStageLightSettings();
  calculateDifficulty();
  applyTargetNumbering(false);
  if (currentStage.setupListAuto) recalculateSetupList(true);
  renderStage();
  renderObjectForm();
  markDirty();
  setStatus("Objekt gelöscht");
  updateObjectActionBar();
}

function rotateSelectedObject(delta) {
  const objects = selectedObjects().filter(obj => !obj.locked);
  if (!objects.length) return;
  pushUndoState();
  objects.forEach(obj => {
    obj.rotation = normalizeRotation((Number(obj.rotation) || 0) + delta);
  });
  renderStage();
  renderObjectForm();
  markDirty();
}

function duplicateSelectedObject() {
  const objects = selectedObjects().filter(obj => !obj.locked);
  if (!objects.length || !activeRange) return;
  pushUndoState();
  const copies = objects.map(obj => {
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = crypto.randomUUID();
    copy.locked = false;
    copy.xM = round2(copy.xM + .5);
    copy.yM = round2(copy.yM + .5);
    applyCenterBounds(copy);
    return copy;
  });
  currentStage.objects.push(...copies);
  if (copies.some(copy => copy.type === "target")) applyTargetNumbering(false);
  selectedObjectId = copies[copies.length - 1].id;
  selectedObjectIds = new Set(copies.map(copy => copy.id));
  renderAmmoFields();
  calculateDifficulty();
  if (currentStage.setupListAuto) recalculateSetupList(true);
  renderStage();
  renderObjectForm();
  activateTab("object");
  markDirty();
  setStatus("Objekt dupliziert");
  updateObjectActionBar();
}

function handleShortcuts(event) {
  const tag = (event.target && event.target.tagName || "").toLowerCase();
  const editingText = ["input", "textarea", "select"].includes(tag);
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoEditor(); else undoEditor();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redoEditor();
    return;
  }
  if (editingText && !((event.ctrlKey || event.metaKey) && key === "d")) return;
  if (event.key.toLowerCase() === "q") {
    event.preventDefault();
    rotateSelectedObject(-15);
  } else if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    rotateSelectedObject(15);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
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
  ensureSelection(null);
  resetEditorHistory();
  clearSavedStageReference();
  syncStageToForm();
  renderStage();
  updateObjectActionBar();
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
    commitObjectFormHistory();
    readStageFromForm();
    const method = currentStage.id ? "PUT" : "POST";
    const url = currentStage.id ? `/api/stages/${currentStage.id}` : "/api/stages";
    currentStage = await api(url, { method, body: JSON.stringify(currentStage) });
    await loadStages();
    syncStageToForm();
    renderStage();
    stageDirty = false;
    rememberSavedStageReference();
    setSaveState("saved", "Gespeichert");
    setStatus("Stage gespeichert");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openLoadDialog() {
  await loadStages();
  renderStageFilterOptions();
  renderStageLoadList();
  $("loadDialog").showModal();
}

function renderStageFilterOptions() {
  const rangeOptions = ranges.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
  $("stageFilterRange").innerHTML = `<option value="">Alle Schiesskeller</option>${rangeOptions}`;
  $("stageFilterFocus").innerHTML = `<option value="">Alle Schwerpunkte</option>${focusAreas.map(item => `<option>${escapeHtml(item)}</option>`).join("")}`;
}

function renderStageLoadList() {
  const query = ($("stageSearch").value || "").trim().toLowerCase();
  const rangeId = $("stageFilterRange").value;
  const weapon = $("stageFilterWeapon").value;
  const difficulty = $("stageFilterDifficulty").value;
  const focus = $("stageFilterFocus").value;
  const filtered = stages.filter(stage => {
    const haystack = [stage.name, stage.description, stage.trainingGoal, stage.procedure].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (rangeId && String(stage.rangeId) !== rangeId) return false;
    if (weapon && stage.weaponType !== weapon) return false;
    if (difficulty && stage.difficultyCalculated !== difficulty) return false;
    if (focus && !(stage.focusAreas || []).includes(focus)) return false;
    return true;
  });
  $("stageList").innerHTML = filtered.map(s => {
    const range = ranges.find(r => r.id === s.rangeId);
    const meta = [range && range.name, labelWeapon(s.weaponType), s.difficultyCalculated].filter(Boolean).join(" · ");
    return `<button type="button" data-id="${s.id}"><b>${escapeHtml(s.name)}</b><br><small>${escapeHtml(meta)}</small></button>`;
  }).join("") || "<div class='empty-list'>Keine passenden Stages gefunden</div>";
  $("stageList").querySelectorAll("button").forEach(btn => btn.addEventListener("click", async () => {
    const payload = await api(`/api/stages/${btn.dataset.id}`);
    currentStage = payload.stage;
    activeRange = payload.range;
    ensureSelection(null);
    resetEditorHistory();
    renderRangeSelect();
    syncStageToForm();
    renderStage();
    updateObjectActionBar();
    $("loadDialog").close();
    stageDirty = false;
    rememberSavedStageReference();
    setSaveState("saved", "Gespeichert");
    setStatus("Stage geladen");
  }));
}

async function duplicateStage() {
  if (!currentStage.id) return setStatus("Stage zuerst speichern", true);
  currentStage = await api(`/api/stages/${currentStage.id}/duplicate`, { method: "POST" });
  await loadStages();
  ensureSelection(null);
  resetEditorHistory();
  syncStageToForm();
  stageDirty = false;
  rememberSavedStageReference();
  setSaveState("saved", "Gespeichert");
  setStatus("Stage dupliziert");
}

async function deleteStage() {
  if (!currentStage.id) return setStatus("Stage zuerst speichern", true);
  if (!confirm("Stage wirklich löschen?")) return;
  try {
    await api(`/api/stages/${currentStage.id}`, { method: "DELETE" });
    await loadStages();
    if (stages.length) {
      const payload = await api(`/api/stages/${stages[0].id}`);
      currentStage = payload.stage;
      activeRange = payload.range;
    } else {
      currentStage = blankStage((activeRange && activeRange.id) || (ranges[0] && ranges[0].id) || null);
    }
    ensureSelection(null);
    resetEditorHistory();
    rememberSavedStageReference();
    renderRangeSelect();
    syncStageToForm();
    renderStage();
    updateObjectActionBar();
    stageDirty = false;
    rememberSavedStageReference();
    setSaveState("saved", "Gespeichert");
    setStatus("Stage gelöscht");
  } catch (error) {
    setStatus(error.message, true);
  }
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
    ensureSelection(null);
    resetEditorHistory();
    rememberSavedStageReference();
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
  ensureSelection(null);
  resetEditorHistory();
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
function round1(value) { return Math.round(value * 10) / 10; }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
function labelWeapon(value) {
  return { kurzwaffe: "Kurzwaffe", langwaffe: "Langwaffe", kurzwaffe_langwaffe: "Kurzwaffe + Langwaffe" }[value] || value;
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch(error => setStatus(error.message, true));
});
