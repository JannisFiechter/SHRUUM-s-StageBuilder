import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { OBJECT_TYPES, toggleBackstop } from "../lib/model.js";
import { bounds, center, corners, normalizeRect, rectsOverlap, rotatePoint, snapAngle, snapDelta, unionBounds, clampCenterToRange, round } from "../lib/geometry.js";
import { Boundary, ObjectLabels, ObjectNode, RangeFloor, sortObjects } from "./StageScene.jsx";

const MIN_SCALE = 4;
const MAX_SCALE = 400;
const FIT_PADDING = 56;

const Canvas = forwardRef(function Canvas({ editor, snapEnabled, showGrid, boundaryEdit, onDropType, onViewChange }, ref) {
  const { doc, selection } = editor;
  const { stage, range } = doc;
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState(null);
  const [view, setView] = useState({ s: 30, tx: 40, ty: 40 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const interaction = useRef(null);
  const pointers = useRef(new Map());
  const [guides, setGuides] = useState({ x: null, y: null });
  const [marquee, setMarquee] = useState(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const fittedFor = useRef(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(50, width), h: Math.max(50, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = size ? Math.min(FIT_PADDING, size.w * 0.07) : FIT_PADDING;

  const fit = useCallback(() => {
    if (!size) return;
    const s = Math.min((size.w - pad * 2) / range.widthM, (size.h - pad * 2) / range.heightM);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    setView({ s: scale, tx: (size.w - range.widthM * scale) / 2, ty: (size.h - range.heightM * scale) / 2 });
  }, [size, pad, range.widthM, range.heightM]);

  // Startansicht: bei langen Kellern auf die Breite einpassen, damit Objekte gut bedienbar sind.
  // Die Zielseite (oben, Kugelfang) ist dabei sichtbar; der Rest per Verschieben oder «Einpassen».
  const initialView = useCallback(() => {
    if (!size) return;
    const all = Math.min((size.w - pad * 2) / range.widthM, (size.h - pad * 2) / range.heightM);
    const byWidth = (size.w - pad * 2) / range.widthM;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.max(all, Math.min(byWidth, 60))));
    const contentH = range.heightM * s;
    const ty = contentH + pad * 2 <= size.h ? (size.h - contentH) / 2 : pad + 8;
    setView({ s, tx: (size.w - range.widthM * s) / 2, ty });
  }, [size, pad, range.widthM, range.heightM]);

  useEffect(() => {
    const key = `${stage.id}:${range.widthM}x${range.heightM}`;
    if (fittedFor.current !== key && size) {
      fittedFor.current = key;
      initialView();
    }
  }, [stage.id, range.widthM, range.heightM, size, initialView]);

  useEffect(() => {
    onViewChange && onViewChange(view.s);
  }, [view.s, onViewChange]);

  const zoomAt = useCallback((factor, sx, sy) => {
    setView((v) => {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.s * factor));
      const k = s / v.s;
      return { s, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
    });
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    zoomIn: () => size && zoomAt(1.25, size.w / 2, size.h / 2),
    zoomOut: () => size && zoomAt(0.8, size.w / 2, size.h / 2),
    viewCenter: () => {
      const v = viewRef.current;
      const sz = size || { w: 800, h: 600 };
      const x = (sz.w / 2 - v.tx) / v.s;
      const y = (sz.h / 2 - v.ty) / v.s;
      return { x: Math.min(range.widthM - 0.5, Math.max(0.5, x)), y: Math.min(range.heightM - 0.5, Math.max(0.5, y)) };
    },
  }), [fit, zoomAt, size, range.widthM, range.heightM]);

  // Leertaste hält für Verschieben der Ansicht
  useEffect(() => {
    const down = (e) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Wheel: mit Ctrl/Pinch zoomen, sonst Ansicht verschieben (Trackpad-freundlich)
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const isMouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && !e.shiftKey);
      if (e.ctrlKey || e.metaKey || isMouseWheel) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
      } else {
        setView((v) => ({ ...v, tx: v.tx - (e.shiftKey ? e.deltaY : e.deltaX), ty: v.ty - (e.shiftKey ? 0 : e.deltaY) }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toWorld = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.tx) / v.s, y: (clientY - rect.top - v.ty) / v.s, sx: clientX - rect.left, sy: clientY - rect.top };
  }, []);

  const objectsById = new Map(stage.objects.map((o) => [o.id, o]));
  const selectedObjects = selection.map((id) => objectsById.get(id)).filter(Boolean);

  // ----- Pointer-Handling -----
  const beginPan = (e) => {
    interaction.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, view: viewRef.current };
    setPanning(true);
  };

  const onBackgroundDown = (e) => {
    if (e.button === 2) return;
    svgRef.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) return startPinch();
    if (spaceDown || e.button === 1 || e.pointerType === "touch") return beginPan(e);
    if (boundaryEdit) return;
    const p = toWorld(e.clientX, e.clientY);
    interaction.current = { kind: "marquee", start: p, additive: e.shiftKey, base: e.shiftKey ? selection : [] };
    if (!e.shiftKey) editor.select([]);
  };

  const onObjectDown = (e, obj) => {
    if (e.button === 2 || boundaryEdit) return;
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) return startPinch();
    if (spaceDown || e.button === 1) return beginPan(e);
    let ids = selection;
    if (e.shiftKey) {
      ids = selection.includes(obj.id) ? selection.filter((id) => id !== obj.id) : [...selection, obj.id];
      editor.select(ids);
      if (!ids.includes(obj.id)) return;
    } else if (!selection.includes(obj.id)) {
      ids = [obj.id];
      editor.select(ids);
    }
    const moving = ids.map((id) => objectsById.get(id)).filter((o) => o && !o.locked);
    if (!moving.length) return;
    const movingSet = new Set(moving.map((o) => o.id));
    interaction.current = {
      kind: "move",
      start: toWorld(e.clientX, e.clientY),
      base: editor.getState().doc,
      originals: new Map(moving.map((o) => [o.id, o])),
      movingBounds: unionBounds(moving),
      others: stage.objects.filter((o) => !movingSet.has(o.id)).map(bounds),
      moved: false,
    };
  };

  const onRotateDown = (e, obj) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    interaction.current = { kind: "rotate", id: obj.id, center: center(obj), base: editor.getState().doc };
  };

  const onResizeDown = (e, obj, mode) => {
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    // Fixpunkt: linke obere Ecke im lokalen Rahmen
    const anchor = rotatePoint({ x: obj.xM, y: obj.yM }, center(obj), obj.rotation);
    interaction.current = { kind: "resize", id: obj.id, mode, anchor, original: obj, base: editor.getState().doc };
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    interaction.current = { kind: "pinch", startDist: dist(a, b), startMid: mid(a, b), view: viewRef.current };
    setMarquee(null);
  };

  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const it = interaction.current;
    if (!it) return;
    if (it.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = svgRef.current.getBoundingClientRect();
      const m = mid(a, b);
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, it.view.s * (dist(a, b) / it.startDist)));
      const k = s / it.view.s;
      const sx = it.startMid.x - rect.left;
      const sy = it.startMid.y - rect.top;
      setView({ s, tx: sx - (sx - it.view.tx) * k + (m.x - it.startMid.x), ty: sy - (sy - it.view.ty) * k + (m.y - it.startMid.y) });
      return;
    }
    if (it.kind === "pan") {
      setView({ ...it.view, tx: it.view.tx + e.clientX - it.start.x, ty: it.view.ty + e.clientY - it.start.y });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (it.kind === "marquee") {
      const r = normalizeRect(it.start.x, it.start.y, p.x, p.y);
      setMarquee(r);
      const hit = stage.objects.filter((o) => rectsOverlap(bounds(o), r)).map((o) => o.id);
      editor.select(it.additive ? [...new Set([...it.base, ...hit])] : hit);
      return;
    }
    if (it.kind === "move") {
      let dx = p.x - it.start.x;
      let dy = p.y - it.start.y;
      if (!it.moved && Math.hypot(dx, dy) * viewRef.current.s < 3) return;
      it.moved = true;
      let gx = null;
      let gy = null;
      if (snapEnabled && !e.altKey) {
        const snapped = snapDelta(it.movingBounds, dx, dy, it.others, range.gridM >= 0.5 ? range.gridM / 2 : range.gridM, 8 / viewRef.current.s);
        dx = snapped.dx;
        dy = snapped.dy;
        gx = snapped.guideX;
        gy = snapped.guideY;
      }
      setGuides({ x: gx, y: gy });
      editor.transient((doc) => ({
        ...doc,
        stage: {
          ...doc.stage,
          objects: doc.stage.objects.map((o) => {
            const orig = it.originals.get(o.id);
            if (!orig) return o;
            return clampCenterToRange({ ...orig, xM: round(orig.xM + dx, 0.001), yM: round(orig.yM + dy, 0.001) }, range);
          }),
        },
      }));
      return;
    }
    if (it.kind === "rotate") {
      let angle = (Math.atan2(p.y - it.center.y, p.x - it.center.x) * 180) / Math.PI + 90;
      if (!e.altKey) angle = snapAngle(angle, e.shiftKey ? 45 : 15);
      angle = ((angle % 360) + 360) % 360;
      it.moved = true;
      editor.transient((doc) => ({ ...doc, stage: { ...doc.stage, objects: doc.stage.objects.map((o) => (o.id === it.id ? { ...o, rotation: angle } : o)) } }));
      return;
    }
    if (it.kind === "resize") {
      const o = it.original;
      const r = (o.rotation * Math.PI) / 180;
      const ux = { x: Math.cos(r), y: Math.sin(r) };
      const uy = { x: -Math.sin(r), y: Math.cos(r) };
      const rel = { x: p.x - it.anchor.x, y: p.y - it.anchor.y };
      let w = rel.x * ux.x + rel.y * ux.y;
      let h = it.mode === "both" ? rel.x * uy.x + rel.y * uy.y : o.heightM;
      const step = snapEnabled && !e.altKey ? 0.1 : 0.01;
      w = Math.max(0.2, round(w, step));
      h = Math.max(0.2, round(h, step));
      const c = { x: it.anchor.x + ux.x * (w / 2) + uy.x * (h / 2), y: it.anchor.y + ux.y * (w / 2) + uy.y * (h / 2) };
      it.moved = true;
      editor.transient((doc) => ({
        ...doc,
        stage: { ...doc.stage, objects: doc.stage.objects.map((obj) => (obj.id === it.id ? fixOpenings({ ...obj, widthM: w, heightM: h, xM: c.x - w / 2, yM: c.y - h / 2 }) : obj)) },
      }));
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const it = interaction.current;
    if (it && it.kind === "pinch") {
      if (pointers.current.size < 2) interaction.current = null;
      return;
    }
    interaction.current = null;
    setPanning(false);
    if (it && it.kind === "pan" && e.pointerType === "touch" && Math.hypot(e.clientX - it.start.x, e.clientY - it.start.y) < 6) {
      editor.select([]);
    }
    setMarquee(null);
    setGuides({ x: null, y: null });
    if (it && (it.kind === "move" || it.kind === "rotate" || it.kind === "resize") && it.moved) {
      editor.commit((doc) => doc, { base: it.base, force: true });
    }
  };

  const toggleSegment = (side, meterIndex) => {
    editor.commit((doc) => ({ ...doc, range: toggleBackstop(doc.range, side, meterIndex) }));
  };

  // Drag & Drop aus der Palette
  const onDragOver = (e) => {
    if (e.dataTransfer.types.includes("application/x-stage-object")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = (e) => {
    const type = e.dataTransfer.getData("application/x-stage-object");
    if (!type) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    onDropType(type, { x: Math.min(range.widthM, Math.max(0, p.x)), y: Math.min(range.heightM, Math.max(0, p.y)) });
  };

  const sorted = sortObjects(stage.objects);
  const selectedSet = new Set(selection);
  const single = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const px = 1 / view.s;
  const meterStep = pickMeterStep(view.s);
  const cursor = panning ? "grabbing" : spaceDown ? "grab" : boundaryEdit ? "crosshair" : "default";

  return (
    <div className="canvas-wrap" ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`canvas ${boundaryEdit ? "boundary-mode" : ""}`}
        width="100%"
        height="100%"
        style={{ cursor }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
          <rect x={-0.02} y={-0.02} width={range.widthM + 0.04} height={range.heightM + 0.04} className="floor-shadow" rx={0.05} />
          <RangeFloor range={range} showGrid={showGrid} />
          <MeterMarks range={range} step={meterStep} px={px} />
          <g className={boundaryEdit ? "objects dimmed" : "objects"}>
            {sorted.map((obj) => (
              <ObjectNode key={obj.id} obj={obj} className={`${selectedSet.has(obj.id) ? "selected" : ""} ${obj.locked ? "locked" : ""}`} onPointerDown={(e) => onObjectDown(e, obj)} />
            ))}
          </g>
          <ObjectLabels stage={stage} fontSize={Math.max(0.24, 12 * px)} />
          <Boundary range={range} editable={boundaryEdit} onToggle={toggleSegment} strokePx={3} />
          {!boundaryEdit &&
            selectedObjects.map((obj) => <SelectionOutline key={obj.id} obj={obj} px={px} />)}
          {!boundaryEdit && single && !single.locked ? <Handles obj={single} px={px} onRotateDown={onRotateDown} onResizeDown={onResizeDown} /> : null}
          {guides.x !== null ? <line x1={guides.x} y1={-1000} x2={guides.x} y2={1000} className="guide" vectorEffect="non-scaling-stroke" /> : null}
          {guides.y !== null ? <line x1={-1000} y1={guides.y} x2={1000} y2={guides.y} className="guide" vectorEffect="non-scaling-stroke" /> : null}
          {marquee ? <rect x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY} className="marquee" vectorEffect="non-scaling-stroke" /> : null}
        </g>
      </svg>
    </div>
  );
});

export default Canvas;

function fixOpenings(obj) {
  const p = obj.properties || {};
  if (obj.type === "window" && p.openingWidthM > obj.widthM - 0.1) return { ...obj, properties: { ...p, openingWidthM: Math.max(0.1, obj.widthM - 0.1) } };
  if (obj.type === "door" && p.doorWidthM > obj.widthM - 0.1) return { ...obj, properties: { ...p, doorWidthM: Math.max(0.1, obj.widthM - 0.1) } };
  return obj;
}

function SelectionOutline({ obj, px }) {
  const pts = corners(obj).map((p) => `${p.x},${p.y}`).join(" ");
  return <polygon points={pts} className="selection" vectorEffect="non-scaling-stroke" transform={undefined} strokeDasharray={obj.locked ? "4 3" : undefined} style={{ strokeWidth: 1.5 }} data-px={px} />;
}

function Handles({ obj, px, onRotateDown, onResizeDown }) {
  const c = center(obj);
  const spec = OBJECT_TYPES[obj.type];
  const handleR = 6 * px;
  const rotDist = obj.heightM / 2 + 26 * px;
  const rotTop = rotatePoint({ x: c.x, y: c.y - obj.heightM / 2 }, c, obj.rotation);
  const rot = rotatePoint({ x: c.x, y: c.y - rotDist }, c, obj.rotation);
  const right = rotatePoint({ x: obj.xM + obj.widthM, y: c.y }, c, obj.rotation);
  const corner = rotatePoint({ x: obj.xM + obj.widthM, y: obj.yM + obj.heightM }, c, obj.rotation);
  return (
    <g className="handles">
      <line x1={rotTop.x} y1={rotTop.y} x2={rot.x} y2={rot.y} className="handle-stem" vectorEffect="non-scaling-stroke" />
      <circle cx={rot.x} cy={rot.y} r={handleR} className="handle rotate" vectorEffect="non-scaling-stroke" onPointerDown={(e) => onRotateDown(e, obj)}>
        <title>Drehen (Shift: 45°, Alt: frei)</title>
      </circle>
      {spec.resizable === "width" ? (
        <rect x={right.x - handleR} y={right.y - handleR} width={handleR * 2} height={handleR * 2} rx={handleR * 0.3} className="handle resize" vectorEffect="non-scaling-stroke" onPointerDown={(e) => onResizeDown(e, obj, "width")}>
          <title>Länge ändern</title>
        </rect>
      ) : null}
      {spec.resizable === "both" ? (
        <rect x={corner.x - handleR} y={corner.y - handleR} width={handleR * 2} height={handleR * 2} rx={handleR * 0.3} className="handle resize" vectorEffect="non-scaling-stroke" onPointerDown={(e) => onResizeDown(e, obj, "both")}>
          <title>Grösse ändern</title>
        </rect>
      ) : null}
    </g>
  );
}

function MeterMarks({ range, step, px }) {
  const fs = 10.5 * px;
  const marks = [];
  for (let x = 0; x <= range.widthM + 1e-6; x += step) {
    marks.push(<text key={`tx${x}`} x={x} y={-9 * px} fontSize={fs} textAnchor="middle" className="meter">{fmt(x)}</text>);
  }
  for (let y = 0; y <= range.heightM + 1e-6; y += step) {
    marks.push(<text key={`ty${y}`} x={-8 * px} y={y} fontSize={fs} textAnchor="end" dominantBaseline="central" className="meter">{fmt(y)}</text>);
  }
  return <g>{marks}</g>;
}

const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1));

function pickMeterStep(scale) {
  const candidates = [0.5, 1, 2, 5, 10, 20, 50];
  return candidates.find((c) => c * scale >= 34) || 50;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
