import { detectAgentState, type AgentState, type PaneRuntime } from "./activity";

/**
 * Per-pane PTY runtime (last-output time + recent output tail + exit), kept in a
 * plain module-level Map — NOT in the Zustand store — because it updates on every
 * output chunk and must not trigger a React render each time. A 1s ticker reads
 * `snapshotStates()` and writes the derived `AgentState` map into the store, so
 * re-renders happen at most once per second.
 */
const runtime = new Map<string, PaneRuntime>();

const TAIL_MAX = 2048;

/** Record an output chunk for a pane (cheap; no re-render). */
export function noteOutput(paneId: string, text: string): void {
  const now = Date.now();
  const r = runtime.get(paneId);
  if (r) {
    r.lastOutputAt = now;
    r.tail = (r.tail + text).slice(-TAIL_MAX);
    r.exited = false;
    r.code = undefined;
  } else {
    runtime.set(paneId, { lastOutputAt: now, tail: text.slice(-TAIL_MAX), exited: false });
  }
}

/** Mark a pane's child as exited (from the Rust `pty-exit` event). */
export function noteExit(paneId: string, code?: number): void {
  const r = runtime.get(paneId);
  if (r) {
    r.exited = true;
    r.code = code;
  } else {
    runtime.set(paneId, { lastOutputAt: Date.now(), tail: "", exited: true, code });
  }
}

/** Drop a pane when its terminal unmounts. */
export function forgetPane(paneId: string): void {
  runtime.delete(paneId);
}

/** Derive every tracked pane's current state at time `now`. */
export function snapshotStates(now: number): Record<string, AgentState> {
  const out: Record<string, AgentState> = {};
  for (const [paneId, r] of runtime) out[paneId] = detectAgentState(r, now);
  return out;
}
