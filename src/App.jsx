import { Component, useCallback, useEffect, useState } from "react";
import { createObject, createRange, createStage, normalizeObject, nowIso, uid } from "./lib/model.js";
import { storage } from "./lib/storage.js";
import { buildExport, downloadJson, exportFileName, parseImport, ImportError } from "./lib/io.js";
import Library from "./components/Library.jsx";
import Editor from "./components/Editor.jsx";
import PrintView from "./components/PrintView.jsx";
import { UiProvider, useUi } from "./components/ui.jsx";

export default function App() {
  return (
    <ErrorBoundary>
      <UiProvider>
        <Shell />
      </UiProvider>
    </ErrorBoundary>
  );
}

// Fängt Renderfehler ab, damit die App nicht weiss bleibt. Daten in IndexedDB bleiben erhalten.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Da ist etwas schiefgelaufen.</h1>
        <p>Deine Daten sind lokal gespeichert und nicht verloren.</p>
        <pre>{String(this.state.error && this.state.error.message)}</pre>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            window.location.hash = "/";
            window.location.reload();
          }}
        >
          Zur Übersicht
        </button>
      </div>
    );
  }
}

function readRoute() {
  const m = window.location.hash.match(/^#\/(stage|print)\/(.+)$/);
  return m ? { view: m[1], stageId: decodeURIComponent(m[2]) } : { view: "library", stageId: null };
}

function Shell() {
  const ui = useUi();
  const [ranges, setRanges] = useState([]);
  const [stages, setStages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let [r, s] = await Promise.all([storage.all("ranges"), storage.all("stages")]);
        const seeded = await storage.getSetting("seeded", false);
        if (!r.length && !seeded) {
          const demo = demoData();
          await storage.putMany("ranges", [demo.range]);
          await storage.putMany("stages", [demo.stage]);
          await storage.setSetting("seeded", true);
          r = [demo.range];
          s = [demo.stage];
        }
        setRanges(r);
        setStages(s);
        storage.persist();
      } catch (err) {
        console.error(err);
        ui.toast("Lokaler Speicher nicht verfügbar. Im privaten Modus werden Daten nicht gespeichert.", "error");
      } finally {
        setLoaded(true);
      }
    })();
  }, [ui]);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("stagebuilder-theme", next);
    } catch {
      /* ohne Speicher */
    }
    setTheme(next);
  }, [theme]);

  const openStage = (id) => {
    window.location.hash = `#/stage/${encodeURIComponent(id)}`;
  };
  const openPrint = (id) => {
    window.location.hash = `#/print/${encodeURIComponent(id)}`;
  };
  const goHome = () => {
    window.location.hash = "/";
  };

  const saveFromEditor = useCallback(async (stage, range, { stageChanged, rangeChanged }) => {
    if (stageChanged) await storage.put("stages", stage);
    if (rangeChanged) await storage.put("ranges", range);
    if (stageChanged) setStages((list) => list.map((s) => (s.id === stage.id ? stage : s)));
    if (rangeChanged) setRanges((list) => list.map((r) => (r.id === range.id ? range : r)));
  }, []);

  const createStageIn = async (rangeId) => {
    const stage = createStage(rangeId, { name: `Stage ${stages.filter((s) => s.rangeId === rangeId).length + 1}` });
    await storage.put("stages", stage);
    setStages((list) => [...list, stage]);
    openStage(stage.id);
  };

  const createRangeWith = async (data) => {
    const range = createRange(data);
    const stage = createStage(range.id, { name: "Stage 1" });
    await storage.put("ranges", range);
    await storage.put("stages", stage);
    setRanges((list) => [...list, range]);
    setStages((list) => [...list, stage]);
    openStage(stage.id);
  };

  const duplicateStage = async (id) => {
    const src = stages.find((s) => s.id === id);
    if (!src) return;
    const now = nowIso();
    const copy = { ...src, id: uid(), name: `${src.name} (Kopie)`, objects: src.objects.map((o) => ({ ...o, id: uid() })), createdAt: now, updatedAt: now };
    await storage.put("stages", copy);
    setStages((list) => [...list, copy]);
    ui.toast("Stage dupliziert.", "success");
  };

  const deleteStage = async (id) => {
    const s = stages.find((x) => x.id === id);
    const ok = await ui.confirm({ title: "Stage löschen?", message: `«${s ? s.name : "Stage"}» wird endgültig gelöscht. Exportiere sie vorher, wenn du sie behalten willst.`, confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await storage.remove("stages", id);
    setStages((list) => list.filter((x) => x.id !== id));
  };

  const deleteRange = async (id) => {
    const r = ranges.find((x) => x.id === id);
    const affected = stages.filter((s) => s.rangeId === id);
    const ok = await ui.confirm({
      title: "Schiesskeller löschen?",
      message: `«${r ? r.name : "Keller"}» und ${affected.length} ${affected.length === 1 ? "zugehörige Stage" : "zugehörige Stages"} werden endgültig gelöscht.`,
      confirmLabel: "Alles löschen",
      danger: true,
    });
    if (!ok) return;
    await Promise.all(affected.map((s) => storage.remove("stages", s.id)));
    await storage.remove("ranges", id);
    setStages((list) => list.filter((s) => s.rangeId !== id));
    setRanges((list) => list.filter((x) => x.id !== id));
  };

  const exportStage = (id) => {
    const stage = stages.find((s) => s.id === id);
    const range = ranges.find((r) => r.id === stage.rangeId);
    downloadJson(buildExport({ ranges: range ? [range] : [], stages: [stage] }), exportFileName(stage.name));
  };
  const exportRange = (id) => {
    const range = ranges.find((r) => r.id === id);
    downloadJson(buildExport({ ranges: [range], stages: stages.filter((s) => s.rangeId === id) }), exportFileName(range.name));
  };
  const exportAll = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(buildExport({ ranges, stages }), exportFileName(`stagebuilder-backup-${date}`));
    ui.toast("Backup exportiert.", "success");
  };

  const importFile = async (file) => {
    try {
      const text = await file.text();
      const result = parseImport(text, { rangeIds: new Set(ranges.map((r) => r.id)), stageIds: new Set(stages.map((s) => s.id)) });
      await storage.putMany("ranges", result.ranges);
      await storage.putMany("stages", result.stages);
      setRanges((list) => [...list, ...result.ranges]);
      setStages((list) => [...list, ...result.stages]);
      const parts = [];
      if (result.stages.length) parts.push(`${result.stages.length} ${result.stages.length === 1 ? "Stage" : "Stages"}`);
      if (result.ranges.length) parts.push(`${result.ranges.length} ${result.ranges.length === 1 ? "Keller" : "Keller"}`);
      ui.toast(`Importiert: ${parts.join(", ")}${result.legacy ? " (altes Format)" : ""}.`, "success");
      result.warnings.forEach((w) => ui.toast(w, "error"));
      if (result.stages.length === 1) openStage(result.stages[0].id);
    } catch (err) {
      ui.toast(err instanceof ImportError ? err.message : "Import fehlgeschlagen.", "error");
      if (!(err instanceof ImportError)) console.error(err);
    }
  };

  const install = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  if (!loaded) return <div className="splash" aria-busy="true" />;

  const stage = route.stageId ? stages.find((s) => s.id === route.stageId) : null;
  const range = stage ? ranges.find((r) => r.id === stage.rangeId) : null;

  if (stage && range && route.view === "print") {
    return <PrintView stage={stage} range={range} onBack={() => openStage(stage.id)} />;
  }

  if (stage && range) {
    return <Editor key={stage.id} stage={stage} range={range} onSave={saveFromEditor} onBack={goHome} onPrint={() => openPrint(stage.id)} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <Library
      ranges={ranges}
      stages={stages}
      onOpenStage={openStage}
      onCreateStage={createStageIn}
      onCreateRange={createRangeWith}
      onDuplicateStage={duplicateStage}
      onDeleteStage={deleteStage}
      onDeleteRange={deleteRange}
      onExportStage={exportStage}
      onPrintStage={openPrint}
      onExportRange={exportRange}
      onExportAll={exportAll}
      onImport={importFile}
      theme={theme}
      onToggleTheme={toggleTheme}
      installPrompt={installPrompt}
      onInstall={install}
    />
  );
}

function demoData() {
  const range = createRange({ name: "Schiesskeller 25 m", widthM: 10, heightM: 25 });
  const place = (type, x, y, extra = {}) => normalizeObject({ ...createObject(type, x, y), ...extra });
  const objects = [
    place("start", 5, 21.5),
    place("arrow", 5, 18.6, { rotation: 270, widthM: 2.4 }),
    place("wall", 3.2, 15, { widthM: 2.4, rotation: 90 }),
    place("window", 7, 13, { widthM: 2.5 }),
    place("marker", 7, 14.2),
    place("target", 2.5, 5),
    place("target", 4.2, 4.2),
    place("noShoot", 5.8, 4.4),
    place("target", 7.5, 5),
    place("popper", 1.4, 8.2),
    place("steelPlate", 8.8, 7.5),
    place("barrel", 4, 10.5),
    place("note", 5, 23.7, { properties: { text: "Start: Hände an der Wand" }, widthM: 3.2 }),
  ];
  const stage = createStage(range.id, {
    name: "Beispiel: Fenster und Wand",
    trainingType: "dynamisch",
    focusAreas: ["Bewegung", "Zielwechsel", "Entscheidung / No-Shoot"],
    description: "Beispiel-Stage. Du kannst sie bearbeiten oder löschen.",
    procedure: "Start in der Box. Auf Signal Ziele T1 und T2 von der linken Wandseite, dann zum Fenster und T3, Popper und Stahlplatte.",
    objects,
  });
  return { range, stage };
}
