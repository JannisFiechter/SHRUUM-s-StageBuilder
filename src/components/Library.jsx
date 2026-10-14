import { useMemo, useRef, useState } from "react";
import { TRAINING_TYPES, WEAPON_TYPES, ammoSummary } from "../lib/model.js";
import { StageThumbnail } from "./StageScene.jsx";
import Icon from "./Icon.jsx";
import { Button, Dialog, Field, IconButton, NumberInput, TextInput } from "./ui.jsx";

const label = (list, value) => (list.find((x) => x.value === value) || {}).label || value;

export default function Library({ ranges, stages, onOpenStage, onCreateStage, onCreateRange, onDuplicateStage, onDeleteStage, onDeleteRange, onExportStage, onPrintStage, onExportRange, onExportAll, onImport, theme, onToggleTheme, installPrompt, onInstall }) {
  const [query, setQuery] = useState("");
  const [rangeDialog, setRangeDialog] = useState(false);
  const fileRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...stages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return sorted;
    return sorted.filter((s) => [s.name, s.description, s.focusAreas.join(" "), s.trainingType].join(" ").toLowerCase().includes(q));
  }, [stages, query]);

  const rangeById = new Map(ranges.map((r) => [r.id, r]));
  const sortedRanges = [...ranges].sort((a, b) => a.name.localeCompare(b.name, "de-CH"));

  return (
    <div className="library">
      <header className="lib-header">
        <div className="brand">
          <img src="icons/icon.svg" alt="" width={34} height={34} />
          <div>
            <h1>SHRUUM&apos;s StageBuilder</h1>
            <p>Trainingsaufbauten planen, offline auf jedem Gerät.</p>
          </div>
        </div>
        <div className="lib-actions">
          {installPrompt ? (
            <Button icon="Download" onClick={onInstall}>
              App installieren
            </Button>
          ) : null}
          <Button icon="Upload" onClick={() => fileRef.current.click()}>
            Importieren
          </Button>
          <Button icon="Save" onClick={onExportAll} disabled={!ranges.length}>
            Backup
          </Button>
          <IconButton icon={theme === "dark" ? "Sun" : "Moon"} label="Hell/Dunkel" onClick={onToggleTheme} />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              e.target.value = "";
              if (file) onImport(file);
            }}
          />
        </div>
      </header>

      <div className="lib-toolbar">
        <div className="search">
          <Icon name="Search" size={16} />
          <input type="search" placeholder="Stages durchsuchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button icon="Plus" variant="primary" onClick={() => (ranges.length ? onCreateStage(sortedRanges[0].id) : setRangeDialog(true))}>
          Neue Stage
        </Button>
      </div>

      {query ? (
        <section className="lib-section">
          <h2 className="section-title">{filtered.length} Treffer</h2>
          <div className="stage-grid">
            {filtered.map((s) => (
              <StageCard key={s.id} stage={s} range={rangeById.get(s.rangeId)} onOpen={() => onOpenStage(s.id)} onDuplicate={() => onDuplicateStage(s.id)} onDelete={() => onDeleteStage(s.id)} onExport={() => onExportStage(s.id)} onPrint={() => onPrintStage(s.id)} />
            ))}
          </div>
        </section>
      ) : (
        <>
          {sortedRanges.map((range) => {
            const rangeStages = filtered.filter((s) => s.rangeId === range.id);
            return (
              <section key={range.id} className="lib-section">
                <div className="section-head">
                  <div className="range-title">
                    <span className="range-mini">
                      <StageThumbnail range={range} stage={null} />
                    </span>
                    <div>
                      <h2>{range.name}</h2>
                      <span className="muted small">
                        {fmt(range.widthM)} × {fmt(range.heightM)} m · {rangeStages.length} {rangeStages.length === 1 ? "Stage" : "Stages"}
                      </span>
                    </div>
                  </div>
                  <div className="section-actions">
                    <Button icon="Plus" onClick={() => onCreateStage(range.id)}>
                      Stage
                    </Button>
                    <IconButton icon="FileJson" label="Keller mit Stages exportieren" onClick={() => onExportRange(range.id)} />
                    <IconButton icon="Trash2" label="Keller löschen" className="danger" onClick={() => onDeleteRange(range.id)} />
                  </div>
                </div>
                {rangeStages.length ? (
                  <div className="stage-grid">
                    {rangeStages.map((s) => (
                      <StageCard key={s.id} stage={s} range={range} onOpen={() => onOpenStage(s.id)} onDuplicate={() => onDuplicateStage(s.id)} onDelete={() => onDeleteStage(s.id)} onExport={() => onExportStage(s.id)} onPrint={() => onPrintStage(s.id)} />
                    ))}
                  </div>
                ) : (
                  <button type="button" className="empty-card" onClick={() => onCreateStage(range.id)}>
                    <Icon name="Plus" size={22} />
                    <span>Erste Stage in diesem Keller anlegen</span>
                  </button>
                )}
              </section>
            );
          })}
          <button type="button" className="add-range" onClick={() => setRangeDialog(true)}>
            <Icon name="LayoutGrid" size={18} />
            <span>Neuen Schiesskeller anlegen</span>
          </button>
        </>
      )}

      <RangeDialog
        open={rangeDialog}
        onClose={() => setRangeDialog(false)}
        onCreate={(data) => {
          setRangeDialog(false);
          onCreateRange(data);
        }}
      />
    </div>
  );
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function StageCard({ stage, range, onOpen, onDuplicate, onDelete, onExport, onPrint }) {
  const ammo = ammoSummary(stage);
  return (
    <article className="stage-card">
      <button type="button" className="stage-card-main" onClick={onOpen} aria-label={`${stage.name} öffnen`}>
        <div className="stage-card-thumb">
          <StageThumbnail stage={stage} range={range} />
        </div>
        <div className="stage-card-body">
          <h3>{stage.name || "Ohne Namen"}</h3>
          <div className="tags">
            <span className="tag">{label(TRAINING_TYPES, stage.trainingType)}</span>
            <span className="tag">{label(WEAPON_TYPES, stage.weaponType)}</span>
            <span className="tag accent">
              <Icon name="Crosshair" size={12} /> {ammo.perRun} Schuss
            </span>
          </div>
          <span className="muted small">Geändert {relative(stage.updatedAt)}</span>
        </div>
      </button>
      <div className="stage-card-actions">
        <IconButton icon="Printer" label="Drucken / PDF" onClick={onPrint} size={16} />
        <IconButton icon="Copy" label="Duplizieren" onClick={onDuplicate} size={16} />
        <IconButton icon="FileJson" label="Als JSON exportieren" onClick={onExport} size={16} />
        <IconButton icon="Trash2" label="Löschen" className="danger" onClick={onDelete} size={16} />
      </div>
    </article>
  );
}

function relative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 7) return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
  return new Date(iso).toLocaleDateString("de-CH");
}

function RangeDialog({ open, onClose, onCreate }) {
  const [name, setName] = useState("Schiesskeller");
  const [widthM, setWidth] = useState(10);
  const [heightM, setHeight] = useState(25);
  return (
    <Dialog
      open={open}
      title="Neuer Schiesskeller"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onCreate({ name: name.trim() || "Schiesskeller", widthM, heightM })}>
            Anlegen
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput value={name} onChange={setName} autoFocus />
      </Field>
      <div className="grid-2">
        <Field label="Breite">
          <NumberInput value={widthM} unit="m" step={1} min={1} max={200} decimals={1} onChange={setWidth} />
        </Field>
        <Field label="Länge (Schussrichtung)">
          <NumberInput value={heightM} unit="m" step={1} min={1} max={400} decimals={1} onChange={setHeight} />
        </Field>
      </div>
      <p className="muted small">Der Kugelfang wird standardmässig an der oberen Seite gesetzt und lässt sich später pro Meter anpassen.</p>
    </Dialog>
  );
}
