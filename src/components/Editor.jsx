import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createObject, normalizeObject, nowIso, uid } from "../lib/model.js";
import { clampCenterToRange } from "../lib/geometry.js";
import { useEditor, onSelected } from "../lib/useEditor.js";
import { buildExport, downloadJson, exportFileName } from "../lib/io.js";
import Canvas, { isTyping } from "./Canvas.jsx";
import Palette from "./Palette.jsx";
import Inspector from "./Inspector.jsx";
import Icon from "./Icon.jsx";
import { IconButton, useUi } from "./ui.jsx";

const SAVE_DELAY = 500;

export default function Editor({ stage, range, onSave, onBack, onPrint, theme, onToggleTheme }) {
  const editor = useEditor();
  const ui = useUi();
  const canvasRef = useRef(null);
  const [tab, setTab] = useState("stage");
  const [boundaryEdit, setBoundaryEdit] = useState(false);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState("saved");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const clipboard = useRef([]);
  const lastSaved = useRef(null);
  const { doc, selection } = editor;

  useEffect(() => {
    const initial = { stage, range };
    lastSaved.current = initial;
    editor.load(initial);
    // Nur beim Wechsel der Stage neu laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.id]);

  // Speichern: verzögert nach jeder Änderung, sofort vor dem Verlassen des Editors.
  const saveTimer = useRef(null);
  const docRef = useRef(null);
  docRef.current = doc;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveDoc = useCallback(async (current) => {
    const prev = lastSaved.current;
    if (!current || !prev || current === prev) return;
    const now = nowIso();
    const stageChanged = current.stage !== prev.stage;
    const rangeChanged = current.range !== prev.range;
    const next = {
      stage: stageChanged ? { ...current.stage, updatedAt: now } : current.stage,
      range: rangeChanged ? { ...current.range, updatedAt: now } : current.range,
    };
    lastSaved.current = current;
    setSaveState("saving");
    try {
      await onSaveRef.current(next.stage, next.range, { stageChanged, rangeChanged });
      if (docRef.current === current) setSaveState("saved");
    } catch (err) {
      console.error(err);
      lastSaved.current = prev;
      setSaveState("error");
      ui.toast("Speichern fehlgeschlagen. Ist der Browser-Speicher voll?", "error");
    }
  }, [ui]);

  useEffect(() => {
    if (!doc || doc === lastSaved.current) return undefined;
    setSaveState("dirty");
    saveTimer.current = setTimeout(() => saveDoc(doc), SAVE_DELAY);
    return () => clearTimeout(saveTimer.current);
  }, [doc, saveDoc]);

  // Beim Verlassen (auch über den Zurück-Button des Browsers) ausstehende Änderungen sichern
  useEffect(() => () => saveDoc(docRef.current), [saveDoc]);

  const flushAnd = useCallback(
    (fn) => async () => {
      clearTimeout(saveTimer.current);
      await saveDoc(docRef.current);
      fn();
    },
    [saveDoc],
  );
  const handleBack = useMemo(() => flushAnd(onBack), [flushAnd, onBack]);
  const handlePrint = useMemo(() => flushAnd(onPrint), [flushAnd, onPrint]);

  // Auswahl öffnet den Objekt-Tab
  useEffect(() => {
    if (selection.length) setTab("object");
  }, [selection.length]);

  // Alle Aktionen arbeiten im Reducer auf der aktuellen Auswahl, nie auf einem veralteten Render-Stand.
  const addObject = useCallback(
    (type, at) => {
      const pos = at || canvasRef.current.viewCenter();
      editor.commit((d) => {
        const obj = clampCenterToRange(createObject(type, pos.x, pos.y), d.range);
        return { __doc: { ...d, stage: { ...d.stage, objects: [...d.stage.objects, obj] } }, __selection: [obj.id] };
      });
      setBoundaryEdit(false);
    },
    [editor],
  );

  const deleteSelected = useCallback(() => {
    editor.commit((d, sel) => {
      if (!sel.length) return d;
      const set = new Set(sel);
      return { __doc: { ...d, stage: { ...d.stage, objects: d.stage.objects.filter((o) => !set.has(o.id) || o.locked) } }, __selection: [] };
    });
  }, [editor]);

  const copyObjects = (d, source, offset) => {
    const copies = source.map((o) => clampCenterToRange(normalizeObject({ ...o, id: uid(), xM: o.xM + offset, yM: o.yM + offset, locked: false }), d.range));
    return { __doc: { ...d, stage: { ...d.stage, objects: [...d.stage.objects, ...copies] } }, __selection: copies.map((c) => c.id) };
  };

  const pasteObjects = useCallback(
    (source, offset = 0.5) => {
      if (!source.length) return;
      editor.commit((d) => copyObjects(d, source, offset));
    },
    [editor],
  );

  const duplicateSelected = useCallback(() => {
    editor.commit((d, sel) => (sel.length ? copyObjects(d, d.stage.objects.filter((o) => sel.includes(o.id)), 0.5) : d));
  }, [editor]);

  const nudge = useCallback(
    (dx, dy) => {
      editor.commit(onSelected((o) => (o.locked ? o : clampCenterToRange({ ...o, xM: o.xM + dx, yM: o.yM + dy }, editor.getState().doc.range))), { mergeKey: "nudge" });
    },
    [editor],
  );

  const rotateSelected = useCallback(
    (delta) => editor.commit(onSelected((o) => (o.locked ? o : normalizeObject({ ...o, rotation: o.rotation + delta }))), { mergeKey: "rotate-key" }),
    [editor],
  );

  const exportStage = useCallback(() => {
    downloadJson(buildExport({ ranges: [doc.range], stages: [doc.stage] }), exportFileName(doc.stage.name));
    ui.toast("Stage als JSON exportiert.", "success");
  }, [doc, ui]);

  // Tastaturkürzel. Der Listener wird einmal registriert und liest immer den aktuellen Stand,
  // damit direkt nach einer Aktion gedrückte Tasten nicht mit veraltetem Zustand arbeiten.
  const latest = useRef({});
  latest.current = { duplicateSelected, pasteObjects, deleteSelected, nudge, rotateSelected, exportStage, boundaryEdit, onPrint: handlePrint };
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl+P öffnet immer die Druckansicht, auch aus einem Textfeld heraus
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        latest.current.onPrint();
        return;
      }
      if (isTyping(e.target) || document.querySelector(".dialog-backdrop")) return;
      const { doc: d, selection: sel } = editor.getState();
      if (!d) return;
      const l = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        editor.redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        l.duplicateSelected();
      } else if (mod && key === "a") {
        e.preventDefault();
        editor.select(d.stage.objects.map((o) => o.id));
      } else if (mod && key === "c") {
        clipboard.current = d.stage.objects.filter((o) => sel.includes(o.id));
      } else if (mod && key === "v") {
        e.preventDefault();
        l.pasteObjects(clipboard.current, 1);
      } else if (mod && key === "s") {
        e.preventDefault();
        l.exportStage();
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        l.deleteSelected();
      } else if (key === "escape") {
        if (l.boundaryEdit) setBoundaryEdit(false);
        else editor.select([]);
      } else if (key === "r" && !mod) {
        l.rotateSelected(e.shiftKey ? -15 : 15);
      } else if (key.startsWith("arrow") && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.1;
        l.nudge(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
      } else if (key === "0" && mod) {
        e.preventDefault();
        canvasRef.current.fit();
      } else if ((key === "+" || key === "=") && mod) {
        e.preventDefault();
        canvasRef.current.zoomIn();
      } else if (key === "-" && mod) {
        e.preventDefault();
        canvasRef.current.zoomOut();
      } else if (key === "g" && !mod) {
        setShowGrid((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  if (!doc) return null;

  const saveLabel = { saved: "Gespeichert", dirty: "Ungespeichert", saving: "Speichert …", error: "Fehler beim Speichern" }[saveState];

  return (
    <div className={`editor ${inspectorOpen ? "inspector-open" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <IconButton icon="ChevronLeft" label="Zur Übersicht" onClick={handleBack} />
          <div className="doc-title">
            <span className="doc-name">{doc.stage.name || "Ohne Namen"}</span>
            <span className="doc-meta">
              {doc.range.name} · {doc.stage.version}
              <span className={`save-dot ${saveState}`} title={saveLabel} />
              <span className="save-label">{saveLabel}</span>
            </span>
          </div>
        </div>
        <div className="topbar-center">
          <IconButton icon="Undo2" label="Rückgängig" shortcut="Ctrl+Z" onClick={editor.undo} disabled={!editor.canUndo} />
          <IconButton icon="Redo2" label="Wiederholen" shortcut="Ctrl+Shift+Z" onClick={editor.redo} disabled={!editor.canRedo} />
          <span className="sep" />
          <IconButton icon="Magnet" label="Fangen" shortcut="Alt beim Ziehen: aus" active={snap} onClick={() => setSnap((v) => !v)} />
          <IconButton icon="Grid3X3" label="Raster" shortcut="G" active={showGrid} onClick={() => setShowGrid((v) => !v)} />
          <span className="sep" />
          <IconButton icon="ZoomOut" label="Verkleinern" shortcut="Ctrl+−" onClick={() => canvasRef.current.zoomOut()} />
          <button type="button" className="zoom-label" onClick={() => canvasRef.current.fit()} title="Einpassen (Ctrl+0)">
            {Math.round(zoom)} px/m
          </button>
          <IconButton icon="ZoomIn" label="Vergrössern" shortcut="Ctrl++" onClick={() => canvasRef.current.zoomIn()} />
          <IconButton icon="Maximize" label="Einpassen" shortcut="Ctrl+0" onClick={() => canvasRef.current.fit()} />
        </div>
        <div className="topbar-right">
          <IconButton icon="Printer" label="Drucken / PDF" shortcut="Ctrl+P" onClick={handlePrint} />
          <IconButton icon="FileJson" label="Stage als JSON exportieren" shortcut="Ctrl+S" onClick={exportStage} />
          <IconButton icon={theme === "dark" ? "Sun" : "Moon"} label="Hell/Dunkel" onClick={onToggleTheme} />
          <IconButton icon="PanelRight" label="Eigenschaften" className="only-mobile" active={inspectorOpen} onClick={() => setInspectorOpen((v) => !v)} />
        </div>
      </header>

      <div className="workspace">
        <Palette onAdd={(type) => addObject(type)} disabled={boundaryEdit} />
        <main className="stage-area">
          <Canvas ref={canvasRef} editor={editor} snapEnabled={snap} showGrid={showGrid} boundaryEdit={boundaryEdit} onDropType={addObject} onViewChange={setZoom} />
          {boundaryEdit ? (
            <div className="mode-banner">
              <Icon name="Shield" size={16} />
              <span>Kugelfang bearbeiten: Randsegmente antippen, um sie ein- oder auszuschalten.</span>
              <button type="button" className="btn primary small" onClick={() => setBoundaryEdit(false)}>
                Fertig
              </button>
            </div>
          ) : null}
          <div className="mobile-tools">
            <IconButton icon="Undo2" label="Rückgängig" onClick={editor.undo} disabled={!editor.canUndo} />
            <IconButton icon="Redo2" label="Wiederholen" onClick={editor.redo} disabled={!editor.canRedo} />
            <IconButton icon="Maximize" label="Einpassen" onClick={() => canvasRef.current.fit()} />
            {selection.length ? (
              <>
                <span className="sep" />
                <IconButton icon="RotateCw" label="Drehen" onClick={() => rotateSelected(15)} />
                <IconButton icon="Copy" label="Duplizieren" onClick={duplicateSelected} />
                <IconButton icon="Trash2" label="Löschen" className="danger" onClick={deleteSelected} />
              </>
            ) : null}
          </div>
          <div className="hint-bar">
            <span><kbd>Leertaste</kbd> + Ziehen: Ansicht verschieben</span>
            <span><kbd>Ctrl</kbd> + Rad: Zoom</span>
            <span><kbd>R</kbd> Drehen</span>
            <span><kbd>Alt</kbd> Fangen aus</span>
          </div>
        </main>
        <Inspector
          editor={editor}
          tab={tab}
          setTab={setTab}
          boundaryEdit={boundaryEdit}
          setBoundaryEdit={(v) => {
            setBoundaryEdit(v);
            if (v) editor.select([]);
          }}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onClose={inspectorOpen ? () => setInspectorOpen(false) : undefined}
        />
      </div>
    </div>
  );
}
