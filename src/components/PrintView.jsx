import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FOCUS_AREAS, TRAINING_TYPES, WEAPON_TYPES, ammoSummary, materialList } from "../lib/model.js";
import { PAGE_MARGIN_MM, choosePlanLayout, formatM, legendTypes, meterStep, scaleBar, scaleRatio, targetRows } from "../lib/print.js";
import { Boundary, ObjectLabels, ObjectNode, RangeFloor, sortObjects } from "./StageScene.jsx";
import { SymbolPreview } from "./Symbol.jsx";
import Icon from "./Icon.jsx";
import { Button, IconButton, Segmented, Toggle } from "./ui.jsx";

const MM_PX = 96 / 25.4;
const OPTIONS_KEY = "stagebuilder-print-options";
const DEFAULT_OPTIONS = { orientation: "auto", briefing: true, results: true, grid: true };

const label = (list, value) => (list.find((x) => x.value === value) || {}).label || value;

function loadOptions() {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}") };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export default function PrintView({ stage, range, onBack }) {
  const [options, setOptions] = useState(loadOptions);
  const set = (patch) =>
    setOptions((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
      } catch {
        /* ohne Speicher */
      }
      return next;
    });

  const layout = useMemo(() => choosePlanLayout(range, options.orientation), [range, options.orientation]);
  const printedAt = useMemo(() => new Date().toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }), []);

  // Vorschau an die Fensterbreite anpassen
  const stackRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = stackRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width - 32;
      setZoom(Math.min(1, available / (layout.page.pageW * MM_PX)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.page.pageW]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${stage.name} ${stage.version}`.trim();
    const onKey = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.title = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [stage.name, stage.version, onBack]);

  const pageStyle = `@page { size: A4 ${layout.orientation}; margin: ${PAGE_MARGIN_MM}mm; }`;
  const showResults = options.briefing && options.results;

  return (
    <div className="print-view">
      <style>{pageStyle}</style>
      <header className="print-toolbar">
        <div className="pt-left">
          <IconButton icon="ChevronLeft" label="Zurück zum Editor" onClick={onBack} />
          <div className="doc-title">
            <span className="doc-name">Druckansicht</span>
            <span className="doc-meta">{stage.name}</span>
          </div>
        </div>
        <div className="pt-options">
          <Segmented
            small
            value={options.orientation}
            onChange={(v) => set({ orientation: v })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "portrait", label: "Hoch" },
              { value: "landscape", label: "Quer" },
            ]}
          />
          <Toggle checked={options.grid} onChange={(v) => set({ grid: v })} label="Raster" />
          <Toggle checked={options.briefing} onChange={(v) => set({ briefing: v })} label="Briefing" />
          <Toggle checked={showResults} onChange={(v) => set({ results: v, briefing: v ? true : options.briefing })} label="Resultatblatt" />
        </div>
        <div className="pt-right">
          <Button icon="Printer" variant="primary" onClick={() => window.print()}>
            Drucken / PDF
          </Button>
        </div>
      </header>
      <p className="print-hint">
        <Icon name="Info" size={14} />
        <span>
          Für ein PDF im Druckdialog «Als PDF speichern» wählen. Massstab stimmt nur bei 100 % Druckgrösse; «Kopf- und Fusszeilen» ausschalten.
        </span>
      </p>

      <div className="print-stack" ref={stackRef}>
        <div className="print-zoom" style={{ zoom }}>
          <div className="print-root">
            <PlanSheet stage={stage} range={range} layout={layout} options={options} printedAt={printedAt} />
            {options.briefing ? <BriefingSheet stage={stage} range={range} layout={layout} printedAt={printedAt} /> : null}
            {showResults ? <ResultSheet stage={stage} layout={layout} printedAt={printedAt} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function sheetStyle(layout) {
  return {
    "--page-w": `${layout.page.pageW}mm`,
    "--page-h": `${layout.page.pageH}mm`,
    "--content-w": `${layout.page.w}mm`,
    "--content-h": `${layout.page.h}mm`,
    "--margin": `${PAGE_MARGIN_MM}mm`,
    "--header-h": `${layout.headerMm}mm`,
    "--footer-h": `${layout.footerMm}mm`,
    "--side-w": `${layout.sideColumnMm}mm`,
    "--gap": `${layout.gapMm}mm`,
    "--info-h": `${layout.stackedInfoMm}mm`,
  };
}

function SheetHeader({ stage, kicker, compact = false }) {
  return (
    <header className={`ps-header ${compact ? "compact" : ""}`}>
      <div className="ps-title">
        <span className="ps-kicker">{kicker}</span>
        <h1>{stage.name || "Ohne Namen"}</h1>
      </div>
      <div className="ps-meta">
        <span className="ps-version">{stage.version}</span>
        <span>{label(TRAINING_TYPES, stage.trainingType)}</span>
        <span>{label(WEAPON_TYPES, stage.weaponType)}</span>
      </div>
    </header>
  );
}

function SheetFooter({ left, right }) {
  return (
    <footer className="ps-footer">
      <span>SHRUUM&apos;s StageBuilder</span>
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}

// ---------- Blatt 1: Plan ----------
function PlanSheet({ stage, range, layout, options, printedAt }) {
  const ammo = ammoSummary(stage);
  const legend = legendTypes(stage);
  const hasBackstop = range.boundaryBackstops.length > 0;
  return (
    <section className={`sheet fixed plan-sheet layout-${layout.layout}`} style={sheetStyle(layout)}>
      <SheetHeader stage={stage} kicker={`Stage · ${range.name}`} />
      <div className="ps-body">
        <div className="ps-plan-cell">
          <PrintPlan stage={stage} range={range} layout={layout} showGrid={options.grid} />
        </div>
        <aside className="ps-info">
          <InfoBlock title="Eckdaten">
            <dl className="ps-facts">
              {stage.weaponType !== "langwaffe" ? <Fact k="Start Kurzwaffe" v={stage.startPositionHandgun} /> : null}
              {stage.weaponType !== "kurzwaffe" ? <Fact k="Start Langwaffe" v={stage.startPositionLongGun} /> : null}
              <Fact k="Scheibentyp" v={stage.targetType} />
              <Fact k="Keller" v={`${formatM(range.widthM)} × ${formatM(range.heightM)} m`} />
            </dl>
          </InfoBlock>
          <InfoBlock title="Munition">
            <div className="ps-ammo">
              <div className="ps-ammo-main">
                <span className="ps-big">{ammo.perRun}</span>
                <span className="ps-unit">Schuss pro Durchgang</span>
              </div>
              <div className="ps-ammo-rows">
                <span>
                  {ammo.paperTargets} Scheiben × {stage.ammo.roundsPerTarget}
                </span>
                {ammo.steelRounds ? <span>+ {ammo.steelRounds} Stahl</span> : null}
                <span>
                  {stage.ammo.runs} {stage.ammo.runs === 1 ? "Durchgang" : "Durchgänge"} · total <b>{ammo.total}</b>
                </span>
              </div>
            </div>
          </InfoBlock>
          {stage.focusAreas.length ? (
            <InfoBlock title="Schwerpunkte">
              <div className="ps-tags">
                {FOCUS_AREAS.filter((f) => stage.focusAreas.includes(f)).map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            </InfoBlock>
          ) : null}
          <InfoBlock title="Legende">
            <ul className="ps-legend">
              {hasBackstop ? (
                <li>
                  <span className="ps-legend-sym">
                    <svg viewBox="0 0 20 10" width="20" height="10" aria-hidden="true">
                      <line x1="1" y1="5" x2="19" y2="5" className="legend-backstop" />
                    </svg>
                  </span>
                  <span>Kugelfang</span>
                </li>
              ) : null}
              {legend.map((l) => (
                <li key={l.key}>
                  <span className="ps-legend-sym">
                    <SymbolPreview type={l.key} size={20} />
                  </span>
                  <span>{l.label}</span>
                </li>
              ))}
            </ul>
          </InfoBlock>
          <div className="ps-signoff">
            <span className="ps-check">Aufgebaut</span>
            <span className="ps-check">Kontrolliert</span>
            <span className="ps-line">Leitung</span>
          </div>
        </aside>
      </div>
      <SheetFooter left={`Massstab ca. 1:${scaleRatio(layout.mmPerM)} bei 100 %`} right={`Gedruckt ${printedAt} · Blatt 1`} />
    </section>
  );
}

function InfoBlock({ title, children }) {
  return (
    <section className="ps-block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Fact({ k, v }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v || "–"}</dd>
    </>
  );
}

function PrintPlan({ stage, range, layout, showGrid }) {
  const s = layout.mmPerM;
  const { padM } = layout;
  const fs = 2.3 / s; // ca. 2.3 mm Schrift
  const step = meterStep(s);
  const bar = scaleBar(s);
  const marks = [];
  for (let x = 0; x <= range.widthM + 1e-6; x += step) {
    marks.push(
      <text key={`x${x}`} x={x} y={-1.6 / s} fontSize={fs} textAnchor="middle" className="pp-meter">
        {fmt(x)}
      </text>,
    );
  }
  for (let y = 0; y <= range.heightM + 1e-6; y += step) {
    marks.push(
      <text key={`y${y}`} x={-1.6 / s} y={y} fontSize={fs} textAnchor="end" dominantBaseline="central" className="pp-meter">
        {fmt(y)}
      </text>,
    );
  }
  const barY = range.heightM + 6 / s;
  const tick = 1.2 / s;
  return (
    <svg
      className="print-plan"
      width={`${layout.planMm.w}mm`}
      height={`${layout.planMm.h}mm`}
      viewBox={`${-padM.left} ${-padM.top} ${range.widthM + padM.left + padM.right} ${range.heightM + padM.top + padM.bottom}`}
      role="img"
      aria-label={`Plan ${stage.name}`}
    >
      <RangeFloor range={range} showGrid={showGrid} gridStrokePx={0.6} />
      <rect x={0} y={0} width={range.widthM} height={range.heightM} className="pp-frame" vectorEffect="non-scaling-stroke" />
      {sortObjects(stage.objects).map((obj) => (
        <ObjectNode key={obj.id} obj={obj} />
      ))}
      <ObjectLabels stage={stage} fontSize={2.8 / s} />
      <Boundary range={range} strokePx={2.4} />
      {marks}
      <g className="pp-scalebar">
        {Array.from({ length: 2 }, (_, i) => (
          <rect key={i} x={(bar.meters / 2) * i} y={barY - tick / 2} width={bar.meters / 2} height={tick} className={i % 2 ? "pp-bar-light" : "pp-bar-dark"} vectorEffect="non-scaling-stroke" />
        ))}
        <text x={bar.meters + 1.5 / s} y={barY} fontSize={fs} dominantBaseline="central" className="pp-meter">
          {fmt(bar.meters)} m
        </text>
        <text x={0} y={barY + 3.2 / s} fontSize={fs * 0.9} className="pp-meter">
          Masse in Metern
        </text>
      </g>
    </svg>
  );
}

const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1));

// ---------- Blatt 2: Briefing ----------
function BriefingSheet({ stage, range, layout, printedAt }) {
  const targets = targetRows(stage);
  const material = materialList(stage);
  const texts = [
    { title: "Beschreibung", text: stage.description },
    { title: "Trainingsziel", text: stage.trainingGoal },
    { title: "Ablauf", text: stage.procedure },
  ].filter((t) => t.text && t.text.trim());
  return (
    <section className="sheet flow briefing-sheet" style={sheetStyle(layout)}>
      <SheetHeader stage={stage} kicker="Briefing" compact />
      {texts.length ? (
        <div className="ps-texts">
          {texts.map((t) => (
            <section key={t.title} className="ps-text">
              <h2>{t.title}</h2>
              <p>{t.text}</p>
            </section>
          ))}
        </div>
      ) : null}
      <section className="ps-safety">
        <h2>
          <Icon name="Shield" size={14} /> Sicherheit
        </h2>
        {stage.safetyNotes && stage.safetyNotes.trim() ? <p>{stage.safetyNotes}</p> : <p className="ps-empty">Keine besonderen Hinweise erfasst. Schusswinkel und Kugelfang vor dem Start kontrollieren.</p>}
        <p className="ps-safety-backstop">{backstopSummary(range)}</p>
      </section>

      <div className="ps-two">
        <section className="ps-text">
          <h2>Material</h2>
          {material.length ? (
            <ul className="ps-checklist">
              {material.map((m) => (
                <li key={m.label}>
                  <span className="box" aria-hidden="true" />
                  <span className="count">{m.count}×</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ps-empty">Kein Material platziert.</p>
          )}
        </section>
        <section className="ps-text">
          <h2>Munition</h2>
          <AmmoTable stage={stage} />
        </section>
      </div>

      {targets.length ? (
        <section className="ps-text">
          <h2>Ziele</h2>
          <table className="ps-table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Typ</th>
                <th>Variante</th>
                <th className="num">Schuss</th>
                <th className="num">X</th>
                <th className="num">Y</th>
                <th>Notiz</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className={t.noShoot ? "noshoot" : ""}>
                  <td className="strong">{t.label || "–"}</td>
                  <td>{t.type}</td>
                  <td>{t.detail || "–"}</td>
                  <td className="num">{t.noShoot ? "–" : t.rounds}</td>
                  <td className="num">{formatM(t.xM)}</td>
                  <td className="num">{formatM(t.yM)}</td>
                  <td>{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ps-caption">Position der Zielmitte in Metern: X ab linker Wand, Y ab Kugelfang-Seite oben.</p>
        </section>
      ) : null}
      <SheetFooter left={range.name} right={`Gedruckt ${printedAt} · Briefing`} />
    </section>
  );
}

const SIDE_NAMES = { top: "oben", right: "rechts", bottom: "unten", left: "links" };

function backstopSummary(range) {
  const bySide = {};
  for (const b of range.boundaryBackstops) bySide[b.side] = (bySide[b.side] || 0) + 1;
  const parts = Object.entries(bySide).map(([side, m]) => `${SIDE_NAMES[side]} ${m} m`);
  return parts.length ? `Kugelfang laut Plan: ${parts.join(", ")}. Nur in diese Richtungen schiessen.` : "Im Plan ist kein Kugelfang markiert.";
}

function AmmoTable({ stage }) {
  const a = ammoSummary(stage);
  return (
    <table className="ps-table compact">
      <tbody>
        <tr>
          <td>Papierziele</td>
          <td className="num">
            {a.paperTargets} × {stage.ammo.roundsPerTarget}
          </td>
          <td className="num strong">{a.paperTargets * stage.ammo.roundsPerTarget}</td>
        </tr>
        <tr>
          <td>Stahlziele</td>
          <td className="num">{a.steelRounds ? "je 1" : "–"}</td>
          <td className="num strong">{a.steelRounds}</td>
        </tr>
        <tr className="sum">
          <td>Pro Durchgang</td>
          <td />
          <td className="num strong">{a.perRun}</td>
        </tr>
        <tr className="sum">
          <td>Total</td>
          <td className="num">× {stage.ammo.runs}</td>
          <td className="num strong">{a.total}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ---------- Blatt 3: Resultate ----------
// Zeilenhöhe 9 mm; Kopf, Metazeile, Tabellenkopf und Fuss brauchen zusammen rund 62 mm.
function ResultSheet({ stage, layout, printedAt }) {
  const rows = Math.max(6, Math.floor((layout.page.h - 62) / 9));
  const dynamic = stage.trainingType !== "statisch";
  const cols = dynamic ? ["Zeit (s)", "A", "C", "D", "Miss", "NS", "Strafen", "Resultat"] : ["Serie 1", "Serie 2", "Serie 3", "Total", "Zeit"];
  return (
    <section className="sheet flow result-sheet" style={sheetStyle(layout)}>
      <SheetHeader stage={stage} kicker="Resultate" compact />
      <div className="ps-result-meta">
        <span className="ps-line">Datum</span>
        <span className="ps-line">Ort</span>
        <span className="ps-line">Leitung</span>
      </div>
      <table className="ps-table results">
        <thead>
          <tr>
            <th className="nr">#</th>
            <th className="name">Name</th>
            {cols.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            <th className="note">Bemerkung</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className="nr">{i + 1}</td>
              <td />
              {cols.map((c) => (
                <td key={c} />
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <SheetFooter left={`${stage.ammo.runs} ${stage.ammo.runs === 1 ? "Durchgang" : "Durchgänge"} pro Person`} right={`Gedruckt ${printedAt} · Resultate`} />
    </section>
  );
}
