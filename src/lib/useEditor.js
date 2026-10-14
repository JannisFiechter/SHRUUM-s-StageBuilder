import { useCallback, useReducer, useRef } from "react";

const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 700;

// Ein Snapshot umfasst Stage und Schiesskeller, damit auch Kugelfang-Änderungen rückgängig gemacht werden können.
function reducer(state, action) {
  switch (action.type) {
    case "load":
      return { doc: action.doc, past: [], future: [], selection: [], lastMergeKey: null, lastMergeAt: 0 };
    case "commit": {
      // Der Updater bekommt Dokument und aktuelle Auswahl. Er kann { __doc, __selection } liefern,
      // um gleichzeitig eine neue Auswahl zu setzen (z. B. beim Duplizieren).
      const result = action.updater(state.doc, state.selection);
      const next = result && result.__doc ? result.__doc : result;
      if (result && result.__doc) action = { ...action, selection: result.__selection };
      if (next === state.doc && !action.force) return state;
      const now = Date.now();
      const merge = action.mergeKey && action.mergeKey === state.lastMergeKey && now - state.lastMergeAt < MERGE_WINDOW_MS;
      const past = merge ? state.past : [...state.past, action.base || state.doc].slice(-HISTORY_LIMIT);
      return { ...state, doc: next, past, future: [], lastMergeKey: action.mergeKey || null, lastMergeAt: now, selection: pruneSelection(action.selection ?? state.selection, next) };
    }
    case "transient":
      return { ...state, doc: action.updater(state.doc) };
    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { ...state, doc: previous, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastMergeKey: null, selection: pruneSelection(state.selection, previous) };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { ...state, doc: next, past: [...state.past, state.doc], future: rest, lastMergeKey: null, selection: pruneSelection(state.selection, next) };
    }
    case "select":
      return { ...state, selection: action.ids, lastMergeKey: null };
    default:
      return state;
  }
}

function pruneSelection(ids, doc) {
  if (!ids.length) return ids;
  const existing = new Set(doc.stage.objects.map((o) => o.id));
  const kept = ids.filter((id) => existing.has(id));
  return kept.length === ids.length ? ids : kept;
}

export function useEditor() {
  const [state, dispatch] = useReducer(reducer, { doc: null, past: [], future: [], selection: [], lastMergeKey: null, lastMergeAt: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback((doc) => dispatch({ type: "load", doc }), []);
  const commit = useCallback((updater, opts = {}) => dispatch({ type: "commit", updater, ...opts }), []);
  const transient = useCallback((updater) => dispatch({ type: "transient", updater }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const select = useCallback((ids) => dispatch({ type: "select", ids }), []);

  return {
    doc: state.doc,
    selection: state.selection,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    getState: () => stateRef.current,
    load,
    commit,
    transient,
    undo,
    redo,
    select,
  };
}

// Hilfsfunktionen für unveränderliche Updates
export const updateStage = (fn) => (doc) => ({ ...doc, stage: fn(doc.stage) });
export const updateRange = (fn) => (doc) => ({ ...doc, range: fn(doc.range) });
export const onSelected = (fn) => (doc, selection) => (selection.length ? updateObjects(selection, fn)(doc) : doc);
export const updateObjects = (ids, fn) => (doc) => {
  const set = new Set(ids);
  return { ...doc, stage: { ...doc.stage, objects: doc.stage.objects.map((o) => (set.has(o.id) ? fn(o) : o)) } };
};
