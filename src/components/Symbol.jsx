import { OBJECT_TYPES, normalizeObject } from "../lib/model.js";
import { openingSegments } from "../lib/geometry.js";

const SW = 0.035;
const LIGHT_DEFAULT = "#FF2A2A";

// Zeichnet ein Objekt in seinem ungedrehten Rahmen (Meter). Drehung übernimmt der Aufrufer.
export default function Symbol({ obj }) {
  const spec = OBJECT_TYPES[obj.type];
  const x = obj.xM;
  const y = obj.yM;
  const w = obj.widthM;
  const h = obj.heightM;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const fill = spec.fill;
  const stroke = spec.stroke;
  const p = obj.properties || {};
  const m = Math.min(w, h);

  switch (obj.type) {
    case "wall":
      return <rect x={x} y={y} width={w} height={h} rx={0.02} fill={fill} stroke={stroke} strokeWidth={SW} />;
    case "window": {
      const seg = openingSegments(w, p.openingWidthM, p.openingPosition, p.openingOffsetM);
      return (
        <g>
          <WallPiece x={x} y={y} w={seg.leftM} h={h} spec={spec} />
          <WallPiece x={x + seg.rightStartM} y={y} w={seg.rightM} h={h} spec={spec} />
          <rect x={x + seg.openingStartM} y={y} width={seg.openingEndM - seg.openingStartM} height={h} fill={spec.accent} stroke={stroke} strokeWidth={SW * 0.8} />
          <line x1={x + seg.openingStartM} y1={cy} x2={x + seg.openingEndM} y2={cy} stroke="#3b82f6" strokeWidth={SW} />
        </g>
      );
    }
    case "door": {
      const seg = openingSegments(w, p.doorWidthM, p.doorPosition, p.openingOffsetM);
      const openW = seg.openingEndM - seg.openingStartM;
      const openX = x + seg.openingStartM;
      const hingeX = p.hingeSide === "left" ? openX : openX + openW;
      const side = p.swingDirection === "in" ? 1 : -1;
      const angle = ((p.openAngle || 90) * Math.PI) / 180;
      const theta = p.hingeSide === "left" ? side * angle : Math.PI - side * angle;
      const endX = hingeX + Math.cos(theta) * openW;
      const endY = cy + Math.sin(theta) * openW;
      const closedX = hingeX + (p.hingeSide === "left" ? openW : -openW);
      const sweep = p.hingeSide === "left" ? (side > 0 ? 1 : 0) : side > 0 ? 0 : 1;
      return (
        <g>
          <WallPiece x={x} y={y} w={seg.leftM} h={h} spec={spec} />
          <WallPiece x={x + seg.rightStartM} y={y} w={seg.rightM} h={h} spec={spec} />
          <path d={`M ${closedX} ${cy} A ${openW} ${openW} 0 0 ${sweep} ${endX} ${endY}`} fill="none" stroke={stroke} strokeWidth={SW * 0.6} strokeDasharray="0.08 0.06" />
          <line x1={hingeX} y1={cy} x2={endX} y2={endY} stroke={stroke} strokeWidth={SW * 1.4} strokeLinecap="round" />
          <circle cx={hingeX} cy={cy} r={Math.max(0.04, h * 0.2)} fill={stroke} />
        </g>
      );
    }
    case "backstop": {
      const count = Math.max(2, Math.round(w / 0.3));
      const step = w / count;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.05} fill={fill} stroke={stroke} strokeWidth={SW} />
          {Array.from({ length: count }, (_, i) => (
            <line key={i} x1={x + step * (i + 0.2)} y1={y + h * 0.2} x2={x + step * (i + 0.8)} y2={y + h * 0.8} stroke={spec.accent} strokeWidth={SW * 0.7} opacity={0.75} />
          ))}
        </g>
      );
    }
    case "target":
    case "swinger":
    case "mover":
      return <TargetSymbol obj={obj} spec={spec} />;
    case "popper":
      return (
        <g>
          <circle cx={cx} cy={y + h * 0.36} r={m * 0.26} fill={fill} stroke={stroke} strokeWidth={SW} />
          <path d={`M ${x + w * 0.3} ${y + h * 0.92} L ${x + w * 0.4} ${y + h * 0.56} L ${x + w * 0.6} ${y + h * 0.56} L ${x + w * 0.7} ${y + h * 0.92} Z`} fill={fill} stroke={stroke} strokeWidth={SW} strokeLinejoin="round" />
        </g>
      );
    case "steelPlate":
      return (
        <g>
          <circle cx={cx} cy={cy} r={m * 0.46} fill={fill} stroke={stroke} strokeWidth={SW * 1.3} />
          <circle cx={cx} cy={cy} r={m * 0.16} fill="none" stroke={stroke} strokeWidth={SW * 0.6} opacity={0.6} />
        </g>
      );
    case "plateRack":
      return (
        <g>
          <line x1={x + w * 0.04} y1={y + h * 0.85} x2={x + w * 0.96} y2={y + h * 0.85} stroke={stroke} strokeWidth={SW * 1.4} strokeLinecap="round" />
          {Array.from({ length: 5 }, (_, i) => (
            <circle key={i} cx={x + w * (0.12 + i * 0.19)} cy={y + h * 0.42} r={Math.min(w * 0.08, h * 0.36)} fill={fill} stroke={stroke} strokeWidth={SW} />
          ))}
        </g>
      );
    case "activator":
      return (
        <g>
          <rect x={x + w * 0.15} y={y + h * 0.15} width={w * 0.7} height={h * 0.7} rx={0.06} fill={fill} stroke={stroke} strokeWidth={SW} />
          <path d={`M ${cx + w * 0.06} ${y + h * 0.24} L ${x + w * 0.38} ${cy + h * 0.04} L ${cx} ${cy + h * 0.04} L ${cx - w * 0.06} ${y + h * 0.76} L ${x + w * 0.64} ${cy - h * 0.06} L ${cx} ${cy - h * 0.06} Z`} fill={stroke} />
        </g>
      );
    case "start":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.06} fill={fill} fillOpacity={0.25} stroke={fill} strokeWidth={SW * 1.4} />
          <rect x={x + w * 0.1} y={y + h * 0.1} width={w * 0.8} height={h * 0.8} rx={0.04} fill="none" stroke={fill} strokeWidth={SW * 0.7} strokeDasharray="0.06 0.05" />
          <line x1={x + w * 0.36} y1={y + h * 0.78} x2={x + w * 0.36} y2={y + h * 0.2} stroke={stroke} strokeWidth={SW * 1.2} strokeLinecap="round" />
          <path d={`M ${x + w * 0.36} ${y + h * 0.2} L ${x + w * 0.74} ${y + h * 0.32} L ${x + w * 0.36} ${y + h * 0.46} Z`} fill={stroke} />
        </g>
      );
    case "marker":
      return (
        <g>
          <circle cx={cx} cy={cy} r={m * 0.46} fill={fill} fillOpacity={0.3} stroke={fill} strokeWidth={SW * 1.2} />
          <circle cx={cx} cy={cy} r={m * 0.16} fill={fill} />
        </g>
      );
    case "arrow":
      return (
        <path
          d={`M ${x} ${y + h * 0.36} L ${x + w - h * 0.6} ${y + h * 0.36} L ${x + w - h * 0.6} ${y + h * 0.08} L ${x + w} ${cy} L ${x + w - h * 0.6} ${y + h * 0.92} L ${x + w - h * 0.6} ${y + h * 0.64} L ${x} ${y + h * 0.64} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={SW * 0.8}
          strokeLinejoin="round"
        />
      );
    case "note":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.06} fill={fill} stroke={stroke} strokeWidth={SW * 0.7} />
          <NoteText x={x} y={y} w={w} h={h} text={p.text || obj.label || "Notiz"} color={stroke} />
        </g>
      );
    case "barrel":
      return (
        <g>
          <circle cx={cx} cy={cy} r={m * 0.46} fill={fill} stroke={stroke} strokeWidth={SW} />
          <circle cx={cx} cy={cy} r={m * 0.3} fill="none" stroke={stroke} strokeWidth={SW * 0.6} opacity={0.55} />
        </g>
      );
    case "cone":
      return (
        <g>
          <rect x={x + w * 0.08} y={y + h * 0.08} width={w * 0.84} height={h * 0.84} rx={0.04} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={SW * 0.6} />
          <circle cx={cx} cy={cy} r={m * 0.3} fill={fill} stroke={stroke} strokeWidth={SW * 0.8} />
          <circle cx={cx} cy={cy} r={m * 0.1} fill="#fff7ed" />
        </g>
      );
    case "light":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0.08} fill={p.color || LIGHT_DEFAULT} stroke={stroke} strokeWidth={SW} />
          <circle cx={cx} cy={cy} r={m * 0.22} fill="#fff" opacity={0.85} />
        </g>
      );
    default:
      return <rect x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={SW} />;
  }
}

function WallPiece({ x, y, w, h, spec }) {
  if (w <= 0.001) return null;
  return <rect x={x} y={y} width={w} height={h} rx={0.015} fill={spec.fill} stroke={spec.stroke} strokeWidth={SW} />;
}

function TargetSymbol({ obj, spec }) {
  const { xM: x, yM: y, widthM: w, heightM: h } = obj;
  const p = obj.properties || {};
  const variant = p.targetVariant || "full";
  const noShoot = variant === "no-shoot";
  const fill = noShoot ? "#f8fafc" : spec.fill;
  const stroke = noShoot ? "#dc2626" : spec.stroke;
  const mask = "#e7e5e4";
  let cover = null;
  if (variant === "half") {
    const d = p.variantDirection || "right";
    // Richtung beschreibt die freie Seite, abgedeckt ist die gegenüberliegende Hälfte.
    const c =
      d === "left" ? [x + w / 2, y, w / 2, h] : d === "right" ? [x, y, w / 2, h] : d === "top" ? [x, y + h / 2, w, h / 2] : [x, y, w, h / 2];
    cover = <rect x={c[0]} y={c[1]} width={c[2]} height={c[3]} fill="#334155" opacity={0.85} />;
  } else if (variant === "head-only") {
    cover = <rect x={x + w * 0.28} y={y} width={w * 0.72} height={h} fill="#334155" opacity={0.85} />;
  }
  return (
    <g>
      {obj.type !== "target" ? (
        <line x1={x - 0.05} y1={y + h + 0.06} x2={x + w + 0.05} y2={y + h + 0.06} stroke={spec.stroke} strokeWidth={SW} strokeDasharray={obj.type === "mover" ? "0.08 0.05" : undefined} />
      ) : null}
      <rect x={x} y={y} width={w} height={h} rx={0.04} fill={fill} stroke={stroke} strokeWidth={noShoot ? SW * 1.4 : SW} />
      {!noShoot ? <rect x={x + w * 0.3} y={y + h * 0.22} width={w * 0.4} height={h * 0.56} rx={0.02} fill="none" stroke={stroke} strokeWidth={SW * 0.55} opacity={0.65} /> : null}
      {cover}
      {noShoot ? (
        <g stroke="#dc2626" strokeWidth={SW * 1.2} strokeLinecap="round">
          <line x1={x + w * 0.15} y1={y + h * 0.18} x2={x + w * 0.85} y2={y + h * 0.82} />
          <line x1={x + w * 0.85} y1={y + h * 0.18} x2={x + w * 0.15} y2={y + h * 0.82} />
        </g>
      ) : null}
    </g>
  );
}

function NoteText({ x, y, w, h, text, color }) {
  const size = Math.min(0.32, h * 0.42);
  const maxChars = Math.max(4, Math.floor(w / (size * 0.55)));
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
  return (
    <text x={x + w / 2} y={y + h / 2} fontSize={size} fill={color} textAnchor="middle" dominantBaseline="central" fontWeight="600" style={{ pointerEvents: "none" }}>
      {clipped}
    </text>
  );
}

// Kleine Vorschau eines Objekttyps für die Werkzeugpalette.
export function SymbolPreview({ type, size = 34 }) {
  const isNoShoot = type === "noShoot";
  const realType = isNoShoot ? "target" : type;
  const spec = OBJECT_TYPES[realType];
  const obj = normalizeObject({ type: realType, xM: 0, yM: 0, widthM: spec.widthM, heightM: spec.heightM, properties: isNoShoot ? { targetVariant: "no-shoot" } : {} });
  const pad = Math.max(spec.widthM, spec.heightM) * 0.12 + 0.05;
  const extra = obj.type === "door" ? spec.widthM * 0.35 : 0;
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad - extra * 0.2} ${spec.widthM + pad * 2} ${Math.max(spec.heightM + pad * 2 + extra, spec.widthM * 0.4)}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <Symbol obj={obj} />
    </svg>
  );
}
