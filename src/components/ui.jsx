import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

export function IconButton({ icon, label, onClick, disabled, active, className = "", shortcut, size = 18, variant = "ghost" }) {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button type="button" className={`icon-btn ${variant} ${active ? "active" : ""} ${className}`} onClick={onClick} disabled={disabled} aria-label={label} title={tip} aria-pressed={active === undefined ? undefined : active}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Button({ icon, children, onClick, variant = "secondary", disabled, type = "button", className = "" }) {
  return (
    <button type={type} className={`btn ${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Field({ label, hint, children, inline = false }) {
  return (
    <label className={`field ${inline ? "inline" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

// Zahlenfeld, das während der Eingabe frei editierbar bleibt und erst bei gültigem Wert meldet.
export function NumberInput({ value, onChange, step = 0.1, min, max, unit, decimals = 2 }) {
  const [text, setText] = useState(format(value, decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value, decimals));
  }, [value, decimals]);
  const emit = (raw) => {
    const parsed = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    let v = parsed;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <span className="num-input">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(format(value, decimals));
        }}
        onChange={(e) => {
          setText(e.target.value);
          emit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = Math.round((Number(value) + delta) / step) * step;
            emit(next);
            setText(format(next, decimals));
          }
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </span>
  );
}

const format = (v, d) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10 ** d) / 10 ** d) : "");

export function Select({ value, onChange, options }) {
  return (
    <span className="select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
      <Icon name="ChevronDown" size={14} className="select-chevron" />
    </span>
  );
}

export function Segmented({ value, onChange, options, small = false }) {
  return (
    <div className={`segmented ${small ? "small" : ""}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)} title={o.title || o.label}>
          {o.icon ? <Icon name={o.icon} size={15} /> : null}
          {o.label && !o.iconOnly ? <span>{o.label}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true">
        <span className="thumb-dot" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, autoFocus }) {
  return <input className="text-input" type="text" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return <textarea className="text-input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function Dialog({ open, title, children, onClose, footer, width = 420 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose && onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current && ref.current.querySelector("input, select, textarea, button.primary");
    if (first) first.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <IconButton icon="X" label="Schliessen" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ----- Toasts und Bestätigungen -----
const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setConfirmState({ ...options, resolve });
      }),
    [],
  );

  const close = (result) => {
    if (confirmState) confirmState.resolve(result);
    setConfirmState(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "error" ? "CircleAlert" : t.kind === "success" ? "Check" : "Info"} size={16} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Dialog
        open={Boolean(confirmState)}
        title={confirmState ? confirmState.title : ""}
        onClose={() => close(false)}
        footer={
          <>
            <Button onClick={() => close(false)}>Abbrechen</Button>
            <Button variant={confirmState && confirmState.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {confirmState ? confirmState.confirmLabel || "OK" : "OK"}
            </Button>
          </>
        }
      >
        <p className="confirm-text">{confirmState ? confirmState.message : ""}</p>
      </Dialog>
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);
