import {
  FOCUS_AREAS, OBJECT_TYPES, SIDES, START_POSITIONS_HANDGUN, START_POSITIONS_LONGGUN, TARGET_TYPES, TARGET_VARIANTS,
  TRAINING_TYPES, VARIANT_DIRECTIONS, WEAPON_TYPES, ammoSummary, materialList, normalizeBackstops, normalizeObject, sideLength, targetNumbers,
} from "../lib/model.js";
import { center } from "../lib/geometry.js";
import { alignObjects, distributeObjects } from "../lib/align.js";
import { updateObjects, updateRange, updateStage } from "../lib/useEditor.js";
import Icon from "./Icon.jsx";
import { Button, Field, IconButton, NumberInput, Segmented, Select, TextArea, TextInput, Toggle } from "./ui.jsx";

export default function Inspector({ editor, tab, setTab, boundaryEdit, setBoundaryEdit, onDuplicate, onDelete, onClose }) {
  const { doc, selection } = editor;
  const selected = doc.stage.objects.filter((o) => selection.includes(o.id));
  const tabs = [
    { value: "object", label: "Objekt", icon: "SquareDashedMousePointer" },
    { value: "stage", label: "Stage", icon: "Target" },
    { value: "range", label: "Keller", icon: "LayoutGrid" },
  ];
  return (
    <aside className="inspector" aria-label="Eigenschaften">
      <div className="inspector-head">
        <Segmented value={tab} onChange={setTab} options={tabs} />
        {onClose ? <IconButton icon="X" label="Schliessen" onClick={onClose} className="inspector-close" /> : null}
      </div>
      <div className="inspector-body">
        {tab === "object" ? <ObjectPanel editor={editor} selected={selected} onDuplicate={onDuplicate} onDelete={onDelete} /> : null}
        {tab === "stage" ? <StagePanel editor={editor} /> : null}
        {tab === "range" ? <RangePanel editor={editor} boundaryEdit={boundaryEdit} setBoundaryEdit={setBoundaryEdit} /> : null}
      </div>
    </aside>
  );
}

// ---------- Objekt ----------
function ObjectPanel({ editor, selected, onDuplicate, onDelete }) {
  if (!selected.length) {
    return (
      <div className="empty-state">
        <Icon name="MousePointer2" size={28} />
        <p>Kein Objekt ausgewählt.</p>
        <p className="muted">Objekt anklicken, mit Shift mehrere wählen oder einen Rahmen aufziehen.</p>
      </div>
    );
  }
  if (selected.length > 1) return <MultiPanel editor={editor} selected={selected} onDuplicate={onDuplicate} onDelete={onDelete} />;
  return <SinglePanel editor={editor} obj={selected[0]} onDuplicate={onDuplicate} onDelete={onDelete} />;
}

function SinglePanel({ editor, obj, onDuplicate, onDelete }) {
  const spec = OBJECT_TYPES[obj.type];
  const set = (patch, key) => editor.commit(updateObjects([obj.id], (o) => normalizeObject({ ...o, ...patch })), { mergeKey: `${obj.id}:${key}` });
  const setProp = (patch, key) => set({ properties: { ...obj.properties, ...patch } }, key);
  const c = center(obj);
  const numbers = targetNumbers(editor.doc.stage);
  const isTarget = ["target", "swinger", "mover"].includes(obj.type);
  const typeLabel = obj.type === "target" && obj.properties.targetVariant === "no-shoot" ? "No-Shoot" : spec.label;

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="type-chip">{typeLabel}</span>
        {numbers.get(obj.id) && !obj.label ? <span className="badge">{numbers.get(obj.id)}</span> : null}
        <span className="spacer" />
        <IconButton icon={obj.locked ? "Lock" : "LockOpen"} label={obj.locked ? "Entsperren" : "Sperren"} active={obj.locked} onClick={() => set({ locked: !obj.locked }, "lock")} />
        <IconButton icon="Copy" label="Duplizieren" shortcut="Ctrl+D" onClick={onDuplicate} />
        <IconButton icon="Trash2" label="Löschen" shortcut="Entf" onClick={onDelete} className="danger" />
      </div>

      <Field label={obj.type === "note" ? "Text" : "Beschriftung"}>
        {obj.type === "note" ? (
          <TextArea value={obj.properties.text || ""} onChange={(v) => setProp({ text: v }, "text")} placeholder="Notiz auf dem Plan" rows={2} />
        ) : (
          <TextInput value={obj.label} onChange={(v) => set({ label: v }, "label")} placeholder={numbers.get(obj.id) || "optional"} />
        )}
      </Field>

      <div className="grid-2">
        <Field label="X (Mitte)">
          <NumberInput value={c.x} unit="m" onChange={(v) => set({ xM: v - obj.widthM / 2 }, "x")} />
        </Field>
        <Field label="Y (Mitte)">
          <NumberInput value={c.y} unit="m" onChange={(v) => set({ yM: v - obj.heightM / 2 }, "y")} />
        </Field>
        {spec.resizable ? (
          <Field label="Länge">
            <NumberInput value={obj.widthM} unit="m" min={0.2} max={100} onChange={(v) => set({ widthM: v, xM: c.x - v / 2 }, "w")} />
          </Field>
        ) : null}
        {spec.resizable === "both" ? (
          <Field label="Tiefe">
            <NumberInput value={obj.heightM} unit="m" min={0.2} max={100} onChange={(v) => set({ heightM: v, yM: c.y - v / 2 }, "h")} />
          </Field>
        ) : null}
      </div>

      <Field label="Drehung">
        <div className="rotation-row">
          <input type="range" min={0} max={359} step={1} value={Math.round(obj.rotation)} onChange={(e) => set({ rotation: Number(e.target.value) }, "rot")} />
          <NumberInput value={obj.rotation} unit="°" step={15} decimals={1} onChange={(v) => set({ rotation: v }, "rot")} />
        </div>
        <div className="quick-row">
          {[0, 45, 90, 135, 180, 270].map((a) => (
            <button key={a} type="button" className={`chip ${Math.round(obj.rotation) === a ? "on" : ""}`} onClick={() => set({ rotation: a }, "rotq")}>
              {a}°
            </button>
          ))}
        </div>
      </Field>

      {isTarget ? (
        <>
          <Field label="Variante">
            <Select value={obj.properties.targetVariant} options={TARGET_VARIANTS} onChange={(v) => setProp({ targetVariant: v }, "variant")} />
          </Field>
          {obj.properties.targetVariant === "half" ? (
            <Field label="Freie Seite">
              <Segmented small value={obj.properties.variantDirection} onChange={(v) => setProp({ variantDirection: v }, "dir")} options={VARIANT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label.replace(" frei", "") }))} />
            </Field>
          ) : null}
          <Field label="Notiz zum Ziel">
            <TextInput value={obj.properties.targetNote || ""} onChange={(v) => setProp({ targetNote: v }, "tnote")} placeholder="z. B. nur Kopf, 2 Treffer" />
          </Field>
        </>
      ) : null}

      {obj.type === "window" ? <OpeningFields obj={obj} widthKey="openingWidthM" positionKey="openingPosition" label="Fensterbreite" setProp={setProp} /> : null}
      {obj.type === "door" ? (
        <>
          <OpeningFields obj={obj} widthKey="doorWidthM" positionKey="doorPosition" label="Türbreite" setProp={setProp} />
          <div className="grid-2">
            <Field label="Scharnier">
              <Segmented small value={obj.properties.hingeSide} onChange={(v) => setProp({ hingeSide: v }, "hinge")} options={[{ value: "left", label: "Links" }, { value: "right", label: "Rechts" }]} />
            </Field>
            <Field label="Öffnet">
              <Segmented small value={obj.properties.swingDirection} onChange={(v) => setProp({ swingDirection: v }, "swing")} options={[{ value: "in", label: "Innen" }, { value: "out", label: "Aussen" }]} />
            </Field>
          </div>
          <Field label="Öffnungswinkel">
            <Segmented small value={String(obj.properties.openAngle)} onChange={(v) => setProp({ openAngle: Number(v) }, "angle")} options={["45", "90", "120"].map((v) => ({ value: v, label: `${v}°` }))} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function OpeningFields({ obj, widthKey, positionKey, label, setProp }) {
  const p = obj.properties;
  return (
    <>
      <div className="grid-2">
        <Field label={label}>
          <NumberInput value={p[widthKey]} unit="m" min={0.1} max={obj.widthM - 0.1} onChange={(v) => setProp({ [widthKey]: v }, widthKey)} />
        </Field>
        {p[positionKey] === "custom" ? (
          <Field label="Abstand links">
            <NumberInput value={p.openingOffsetM} unit="m" min={0} max={obj.widthM - p[widthKey]} onChange={(v) => setProp({ openingOffsetM: v }, "offset")} />
          </Field>
        ) : null}
      </div>
      <Field label="Position">
        <Segmented small value={p[positionKey]} onChange={(v) => setProp({ [positionKey]: v }, positionKey)} options={[{ value: "left", label: "Links" }, { value: "center", label: "Mitte" }, { value: "right", label: "Rechts" }, { value: "custom", label: "Frei" }]} />
      </Field>
    </>
  );
}

function MultiPanel({ editor, selected, onDuplicate, onDelete }) {
  const ids = selected.map((o) => o.id);
  const apply = (fn) =>
    editor.commit((doc) => {
      const set = new Set(ids);
      const subset = doc.stage.objects.filter((o) => set.has(o.id));
      const changed = new Map(fn(subset).map((o) => [o.id, o]));
      return { ...doc, stage: { ...doc.stage, objects: doc.stage.objects.map((o) => changed.get(o.id) || o) } };
    });
  const allLocked = selected.every((o) => o.locked);
  return (
    <div className="panel">
      <div className="panel-title">
        <span className="type-chip">{selected.length} Objekte</span>
        <span className="spacer" />
        <IconButton icon={allLocked ? "Lock" : "LockOpen"} label={allLocked ? "Alle entsperren" : "Alle sperren"} active={allLocked} onClick={() => editor.commit(updateObjects(ids, (o) => ({ ...o, locked: !allLocked })))} />
        <IconButton icon="Copy" label="Duplizieren" shortcut="Ctrl+D" onClick={onDuplicate} />
        <IconButton icon="Trash2" label="Löschen" shortcut="Entf" onClick={onDelete} className="danger" />
      </div>
      <Field label="Ausrichten">
        <div className="tool-row">
          <IconButton icon="AlignStartVertical" label="Links ausrichten" onClick={() => apply((s) => alignObjects(s, "left"))} />
          <IconButton icon="AlignCenterVertical" label="Horizontal zentrieren" onClick={() => apply((s) => alignObjects(s, "hcenter"))} />
          <IconButton icon="AlignEndVertical" label="Rechts ausrichten" onClick={() => apply((s) => alignObjects(s, "right"))} />
          <span className="sep" />
          <IconButton icon="AlignStartHorizontal" label="Oben ausrichten" onClick={() => apply((s) => alignObjects(s, "top"))} />
          <IconButton icon="AlignCenterHorizontal" label="Vertikal zentrieren" onClick={() => apply((s) => alignObjects(s, "vcenter"))} />
          <IconButton icon="AlignEndHorizontal" label="Unten ausrichten" onClick={() => apply((s) => alignObjects(s, "bottom"))} />
        </div>
      </Field>
      <Field label="Verteilen" hint="Ab drei Objekten: gleiche Abstände zwischen den Mittelpunkten.">
        <div className="tool-row">
          <IconButton icon="AlignHorizontalDistributeCenter" label="Horizontal verteilen" disabled={selected.length < 3} onClick={() => apply((s) => distributeObjects(s, "x"))} />
          <IconButton icon="AlignVerticalDistributeCenter" label="Vertikal verteilen" disabled={selected.length < 3} onClick={() => apply((s) => distributeObjects(s, "y"))} />
        </div>
      </Field>
      <Field label="Drehung für alle">
        <div className="quick-row">
          {[0, 45, 90, 180, 270].map((a) => (
            <button key={a} type="button" className="chip" onClick={() => editor.commit(updateObjects(ids, (o) => (o.locked ? o : { ...o, rotation: a })))}>
              {a}°
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ---------- Stage ----------
function StagePanel({ editor }) {
  const { stage } = editor.doc;
  const set = (patch, key) => editor.commit(updateStage((s) => ({ ...s, ...patch })), { mergeKey: `stage:${key}` });
  const ammo = ammoSummary(stage);
  const material = materialList(stage);
  const toggleFocus = (f) => set({ focusAreas: stage.focusAreas.includes(f) ? stage.focusAreas.filter((x) => x !== f) : [...stage.focusAreas, f] }, "focus");
  const showHandgun = stage.weaponType !== "langwaffe";
  const showLongGun = stage.weaponType !== "kurzwaffe";
  return (
    <div className="panel">
      <div className="grid-2 name-row">
        <Field label="Name">
          <TextInput value={stage.name} onChange={(v) => set({ name: v }, "name")} />
        </Field>
        <Field label="Version">
          <TextInput value={stage.version} onChange={(v) => set({ version: v }, "version")} />
        </Field>
      </div>
      <Field label="Training">
        <Segmented small value={stage.trainingType} onChange={(v) => set({ trainingType: v }, "type")} options={TRAINING_TYPES} />
      </Field>
      <Field label="Waffe">
        <Select value={stage.weaponType} options={WEAPON_TYPES} onChange={(v) => set({ weaponType: v }, "weapon")} />
      </Field>
      <div className="grid-2">
        {showHandgun ? (
          <Field label="Start Kurzwaffe">
            <Select value={stage.startPositionHandgun} options={withCurrent(START_POSITIONS_HANDGUN, stage.startPositionHandgun)} onChange={(v) => set({ startPositionHandgun: v }, "sph")} />
          </Field>
        ) : null}
        {showLongGun ? (
          <Field label="Start Langwaffe">
            <Select value={stage.startPositionLongGun} options={withCurrent(START_POSITIONS_LONGGUN, stage.startPositionLongGun)} onChange={(v) => set({ startPositionLongGun: v }, "spl")} />
          </Field>
        ) : null}
      </div>
      <Field label="Scheibentyp">
        <Select value={stage.targetType} options={withCurrent(TARGET_TYPES, stage.targetType)} onChange={(v) => set({ targetType: v }, "ttype")} />
      </Field>

      <Field label="Schwerpunkte">
        <div className="chips">
          {FOCUS_AREAS.map((f) => (
            <button key={f} type="button" className={`chip ${stage.focusAreas.includes(f) ? "on" : ""}`} onClick={() => toggleFocus(f)}>
              {f}
            </button>
          ))}
        </div>
      </Field>

      <div className="card">
        <div className="card-head">
          <Icon name="Crosshair" size={16} />
          <span>Munition</span>
        </div>
        <div className="grid-2">
          <Field label="Schuss pro Scheibe">
            <NumberInput value={stage.ammo.roundsPerTarget} step={1} decimals={0} min={1} max={20} onChange={(v) => set({ ammo: { ...stage.ammo, roundsPerTarget: Math.round(v) } }, "rpt")} />
          </Field>
          <Field label="Durchgänge">
            <NumberInput value={stage.ammo.runs} step={1} decimals={0} min={1} max={100} onChange={(v) => set({ ammo: { ...stage.ammo, runs: Math.round(v) } }, "runs")} />
          </Field>
        </div>
        <div className="stats">
          <Stat label="Scheiben" value={ammo.paperTargets} />
          <Stat label="Stahl" value={ammo.steelRounds} />
          <Stat label="Pro Durchgang" value={ammo.perRun} />
          <Stat label="Total" value={ammo.total} strong />
        </div>
        <p className="muted small">Minimum: Scheiben × Schuss pro Scheibe plus ein Schuss pro Stahlziel.</p>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon name="ListChecks" size={16} />
          <span>Material</span>
        </div>
        {material.length ? (
          <ul className="material">
            {material.map((m) => (
              <li key={m.label}>
                <span>{m.label}</span>
                <span className="count">{m.count}×</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Noch keine Objekte platziert.</p>
        )}
      </div>

      <div className="grid-2">
        <Toggle checked={stage.targetNumbering.enabled} onChange={(v) => set({ targetNumbering: { ...stage.targetNumbering, enabled: v } }, "num")} label="Ziele nummerieren" />
        {stage.targetNumbering.enabled ? (
          <Field label="Präfix" inline>
            <TextInput value={stage.targetNumbering.prefix} onChange={(v) => set({ targetNumbering: { ...stage.targetNumbering, prefix: v.slice(0, 4) } }, "prefix")} />
          </Field>
        ) : null}
      </div>

      <Field label="Beschreibung">
        <TextArea value={stage.description} onChange={(v) => set({ description: v }, "desc")} placeholder="Worum geht es in dieser Stage?" />
      </Field>
      <Field label="Trainingsziel">
        <TextArea value={stage.trainingGoal} onChange={(v) => set({ trainingGoal: v }, "goal")} rows={2} />
      </Field>
      <Field label="Ablauf">
        <TextArea value={stage.procedure} onChange={(v) => set({ procedure: v }, "proc")} rows={4} placeholder="Startsignal, Reihenfolge, Positionen …" />
      </Field>
      <Field label="Sicherheitshinweise">
        <TextArea value={stage.safetyNotes} onChange={(v) => set({ safetyNotes: v }, "safety")} rows={2} placeholder="Winkel, Sperrzonen, Ladezustand …" />
      </Field>
    </div>
  );
}

const withCurrent = (list, current) => (current && !list.includes(current) ? [current, ...list] : list);

function Stat({ label, value, strong }) {
  return (
    <div className={`stat ${strong ? "strong" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

// ---------- Schiesskeller ----------
const SIDE_LABEL = { top: "Oben", right: "Rechts", bottom: "Unten", left: "Links" };

function RangePanel({ editor, boundaryEdit, setBoundaryEdit }) {
  const { range } = editor.doc;
  const set = (patch, key) =>
    editor.commit(updateRange((r) => {
      const next = { ...r, ...patch };
      return { ...next, boundaryBackstops: normalizeBackstops(next.boundaryBackstops, next.widthM, next.heightM) };
    }), { mergeKey: `range:${key}` });
  const setSide = (side, active) => {
    const others = range.boundaryBackstops.filter((b) => b.side !== side);
    const full = active ? Array.from({ length: sideLength(range, side) }, (_, i) => ({ side, meterIndex: i, active: true })) : [];
    set({ boundaryBackstops: [...others, ...full] }, `side:${side}`);
  };
  const countActive = (side) => range.boundaryBackstops.filter((b) => b.side === side).length;
  return (
    <div className="panel">
      <p className="notice">
        <Icon name="Info" size={15} />
        <span>Der Schiesskeller gilt für alle Stages, die ihn verwenden.</span>
      </p>
      <Field label="Name">
        <TextInput value={range.name} onChange={(v) => set({ name: v }, "name")} />
      </Field>
      <div className="grid-2">
        <Field label="Breite">
          <NumberInput value={range.widthM} unit="m" step={1} min={1} max={200} decimals={1} onChange={(v) => set({ widthM: v }, "w")} />
        </Field>
        <Field label="Länge">
          <NumberInput value={range.heightM} unit="m" step={1} min={1} max={400} decimals={1} onChange={(v) => set({ heightM: v }, "h")} />
        </Field>
      </div>
      <Field label="Raster">
        <Segmented small value={String(range.gridM)} onChange={(v) => set({ gridM: Number(v) }, "grid")} options={["0.25", "0.5", "1", "2", "5"].map((v) => ({ value: v, label: `${v} m` }))} />
      </Field>

      <div className="card">
        <div className="card-head">
          <Icon name="Shield" size={16} />
          <span>Kugelfang</span>
        </div>
        <p className="muted small">Rote Segmente markieren Begrenzungen mit Kugelfang, also die zulässigen Schussrichtungen.</p>
        <Button icon={boundaryEdit ? "Check" : "Pencil"} variant={boundaryEdit ? "primary" : "secondary"} onClick={() => setBoundaryEdit(!boundaryEdit)} className="full">
          {boundaryEdit ? "Fertig" : "Segmente auf dem Plan bearbeiten"}
        </Button>
        <div className="side-table">
          {SIDES.map((side) => (
            <div key={side} className="side-row">
              <span className="side-name">{SIDE_LABEL[side]}</span>
              <span className="side-count">
                {countActive(side)} / {sideLength(range, side)} m
              </span>
              <button type="button" className="chip" onClick={() => setSide(side, true)}>Alle</button>
              <button type="button" className="chip" onClick={() => setSide(side, false)}>Keine</button>
            </div>
          ))}
        </div>
      </div>

      <Field label="Notizen zum Keller">
        <TextArea value={range.notes} onChange={(v) => set({ notes: v }, "notes")} rows={3} placeholder="Zugang, Licht, Besonderheiten …" />
      </Field>
    </div>
  );
}
