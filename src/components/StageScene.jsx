import { RENDER_ORDER, SIDES, sideLength, targetNumbers } from "../lib/model.js";
import { center } from "../lib/geometry.js";
import Symbol from "./Symbol.jsx";

export function sortObjects(objects) {
  return objects
    .map((obj, index) => ({ obj, index }))
    .sort((a, b) => (RENDER_ORDER[a.obj.type] ?? 50) - (RENDER_ORDER[b.obj.type] ?? 50) || a.index - b.index)
    .map((item) => item.obj);
}

export function RangeFloor({ range, showGrid = true, gridStrokePx = 1 }) {
  const lines = [];
  if (showGrid) {
    const step = range.gridM;
    for (let x = step; x < range.widthM - 1e-6; x += step) {
      const major = Math.abs(x % 5) < 1e-6 || Math.abs((x % 5) - 5) < 1e-6;
      lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={range.heightM} className={major ? "grid major" : "grid"} strokeWidth={gridStrokePx} vectorEffect="non-scaling-stroke" />);
    }
    for (let y = step; y < range.heightM - 1e-6; y += step) {
      const major = Math.abs(y % 5) < 1e-6 || Math.abs((y % 5) - 5) < 1e-6;
      lines.push(<line key={`y${y}`} x1={0} y1={y} x2={range.widthM} y2={y} className={major ? "grid major" : "grid"} strokeWidth={gridStrokePx} vectorEffect="non-scaling-stroke" />);
    }
  }
  return (
    <g>
      <rect x={0} y={0} width={range.widthM} height={range.heightM} className="floor" />
      {lines}
    </g>
  );
}

export function segmentGeometry(range, side, meterIndex) {
  const len = side === "top" || side === "bottom" ? range.widthM : range.heightM;
  const a = meterIndex;
  const b = Math.min(len, meterIndex + 1);
  if (side === "top") return { x1: a, y1: 0, x2: b, y2: 0 };
  if (side === "bottom") return { x1: a, y1: range.heightM, x2: b, y2: range.heightM };
  if (side === "left") return { x1: 0, y1: a, x2: 0, y2: b };
  return { x1: range.widthM, y1: a, x2: range.widthM, y2: b };
}

export function Boundary({ range, editable = false, onToggle, strokePx = 3 }) {
  const active = new Set(range.boundaryBackstops.map((b) => `${b.side}:${b.meterIndex}`));
  const segments = [];
  for (const side of SIDES) {
    const n = sideLength(range, side);
    for (let i = 0; i < n; i++) {
      const g = segmentGeometry(range, side, i);
      const isActive = active.has(`${side}:${i}`);
      segments.push(
        <g key={`${side}${i}`} className={`boundary ${isActive ? "active" : ""} ${editable ? "editable" : ""}`}>
          {editable ? (
            <line {...g} className="boundary-hit" strokeWidth={18} vectorEffect="non-scaling-stroke" onPointerDown={(e) => { e.stopPropagation(); onToggle && onToggle(side, i); }} />
          ) : null}
          <line {...g} className="boundary-line" strokeWidth={isActive ? strokePx * 2 : strokePx * 0.6} vectorEffect="non-scaling-stroke" strokeLinecap="butt" />
        </g>,
      );
    }
  }
  return <g>{segments}</g>;
}

export function ObjectNode({ obj, className = "", onPointerDown }) {
  const c = center(obj);
  return (
    <g className={`object ${className}`} data-id={obj.id} transform={obj.rotation ? `rotate(${obj.rotation} ${c.x} ${c.y})` : undefined} onPointerDown={onPointerDown}>
      <rect className="hit" x={obj.xM - 0.08} y={obj.yM - 0.08} width={obj.widthM + 0.16} height={obj.heightM + 0.16} />
      <Symbol obj={obj} />
    </g>
  );
}

export function ObjectLabels({ stage, fontSize = 0.3 }) {
  const numbers = targetNumbers(stage);
  return (
    <g className="labels">
      {stage.objects.map((obj) => {
        const text = obj.label || numbers.get(obj.id);
        if (!text || obj.type === "note") return null;
        const c = center(obj);
        const r = Math.max(obj.widthM, obj.heightM) / 2;
        return (
          <text key={obj.id} x={c.x} y={c.y - r - fontSize * 0.45} fontSize={fontSize} strokeWidth={fontSize * 0.22} textAnchor="middle" className="obj-label">
            {text}
          </text>
        );
      })}
    </g>
  );
}

// Statische Vorschau für Bibliothek und Karten.
export function StageThumbnail({ stage, range, className = "" }) {
  if (!range) return <div className={`thumb empty ${className}`} />;
  const pad = Math.max(range.widthM, range.heightM) * 0.04;
  return (
    <svg className={`thumb ${className}`} viewBox={`${-pad} ${-pad} ${range.widthM + pad * 2} ${range.heightM + pad * 2}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Vorschau ${stage ? stage.name : range.name}`}>
      <RangeFloor range={range} gridStrokePx={0.5} />
      <Boundary range={range} strokePx={1.2} />
      {stage ? sortObjects(stage.objects).map((obj) => <ObjectNode key={obj.id} obj={obj} />) : null}
    </svg>
  );
}
