import { invoke } from "@tauri-apps/api/core";

/**
 * Serializers for every live terminal pane, in a plain module-level Map — NOT
 * in the Zustand store — for the same reason `agentRuntime.ts` keeps its PTY
 * runtime out of the store: this is touched on mount, unmount, and every flush,
 * and must never trigger a React render.
 *
 * It also has to be reachable from `store.ts`'s hide/unload handlers, which
 * live outside React entirely.
 */
const serializers = new Map<string, () => string>();

export function registerPane(paneId: string, serialize: () => string): void {
  serializers.set(paneId, serialize);
}

export function unregisterPane(paneId: string): void {
  serializers.delete(paneId);
}

export function livePaneIds(): string[] {
  return [...serializers.keys()];
}

/**
 * Serialize every live pane.
 *
 * A pane whose serializer throws (disposed mid-flush) or returns an empty
 * buffer (nothing printed yet) is skipped — one bad pane must not cost the
 * others their history, and an empty file is worse than no file because it
 * would restore as a blank "restored" banner.
 */
export function snapshotAll(): Array<{ paneId: string; data: string }> {
  const out: Array<{ paneId: string; data: string }> = [];
  for (const [paneId, serialize] of serializers) {
    let data: string;
    try {
      data = serialize();
    } catch {
      continue;
    }
    if (data) out.push({ paneId, data });
  }
  return out;
}

/**
 * Persist every live pane's buffer. Best effort: a rejected write is swallowed
 * so a full disk cannot break app shutdown.
 */
export async function saveAllScrollback(): Promise<void> {
  await Promise.all(
    snapshotAll().map(({ paneId, data }) =>
      invoke("scrollback_save", { paneId, data }).catch(() => {}),
    ),
  );
}
