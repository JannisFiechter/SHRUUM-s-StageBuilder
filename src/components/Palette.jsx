import { OBJECT_TYPES, PALETTE_GROUPS } from "../lib/model.js";
import { SymbolPreview } from "./Symbol.jsx";

const ORDER = {
  structure: ["wall", "window", "door", "backstop"],
  targets: ["target", "noShoot", "popper", "steelPlate", "plateRack", "activator"],
  markers: ["start", "marker", "arrow", "note"],
  props: ["barrel", "cone", "light"],
};

export default function Palette({ onAdd, disabled }) {
  return (
    <nav className={`palette ${disabled ? "disabled" : ""}`} aria-label="Objekte">
      {PALETTE_GROUPS.map((group) => (
        <section key={group.id} className="palette-group">
          <h3>{group.label}</h3>
          <div className="palette-items">
            {ORDER[group.id].map((type) => (
              <button
                key={type}
                type="button"
                className="palette-item"
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-stage-object", type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(type)}
                title={`${OBJECT_TYPES[type].label} hinzufügen (klicken oder auf die Fläche ziehen)`}
              >
                <span className="palette-symbol">
                  <SymbolPreview type={type} />
                </span>
                <span className="palette-label">{OBJECT_TYPES[type].label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}
