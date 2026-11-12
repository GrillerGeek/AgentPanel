import { loadGhostty, captureGhosttyNativeSnapshot, getGhosttyHistoryDiagnostics } from "../../lib/terminalRenderer/ghosttyRenderer";
import { normalizedHistorySnapshot, firstHistoryDifference } from "../../lib/terminalRenderer/ghosttyHistory";
import { StyledHistoryRestorer } from "../../lib/terminalRenderer/historyArchive";
import type { GhosttyTerminal } from "../../../vendor/ghostty-history/dist/ghostty-history.js";
import type { AdapterCheck, AdapterEngine, CanvasPaintEvidence } from "./adapterHarness";
import { logicalWrapQuery, styledHistoryFixture } from "./historyWrapFixture";
export { logicalWrapQuery } from "./historyWrapFixture";
export async function loadStyledHistoryFixture(engine: AdapterEngine) {
  await engine.term.whenIdle(); engine.term.reset(); engine.term.resize(24, 12); await engine.write(styledHistoryFixture);
}
function restoreCore(term: GhosttyTerminal, archive: string) {
  return new StyledHistoryRestorer({ grid: () => ({ cols: term.cols, rows: term.rows }), resize: (cols, rows) => term.resize(cols, rows),
    fit() {}, canFit: () => false, idle: async () => {}, write: async (data) => { term.write(data); }, reset: () => term.write("\x1bc") }).restore(archive);
}
export async function historyWrapCompatibility(engine: AdapterEngine): Promise<AdapterCheck[]> {
  const checks: AdapterCheck[] = []; const term = engine.term;
  const record = (name: string, pass: boolean, detail: unknown) => checks.push({ name, status: pass ? "pass" : "fail", detail });
  await loadStyledHistoryFixture(engine);
  const found = term.search(logicalWrapQuery); const copied = term.getSelection(); const presentation = engine.selectionPresentation?.();
  record("authoritative logical cross-wrap search highlights and copies without a hard newline", found.status === "supported" && found.found && copied.status === "supported" && copied.value === logicalWrapQuery && (presentation?.owned?.range?.end.y ?? 0) > (presentation?.owned?.range?.start.y ?? 0) && (presentation?.visibleRects.length ?? 0) >= 2, { found, copied, presentation });
  const black = async (query: string, column: number) => engine.captureCanvasPaint?.(() => { term.search(query); }, column);
  const rgbPaint = await black("RGBblack", 0); const palettePaint = await black("PALblack", 9);
  const paintsBlack = (paint: CanvasPaintEvidence | undefined) => !!paint && !paint.capped && paint.backgroundCalls.some((call) => call.style.replace(/\s/g, "") === "rgb(0,0,0)" || call.style === "#000000");
  const snapshot = captureGhosttyNativeSnapshot(term)!;
  record("explicit RGB and palette black paint over a nonblack default background", snapshot.colors.background !== 0 && paintsBlack(rgbPaint) && paintsBlack(palettePaint), { defaultBackground: snapshot.colors.background, rgbPaint, palettePaint });
  const archived = term.serializeStyledHistory();
  record("bounded primary styled history archive carries semantic metadata", archived.status === "supported" && archived.value.length > 0 && new TextEncoder().encode(archived.value).length <= 256 * 1024, { capture: archived.status, diagnostics: getGhosttyHistoryDiagnostics(term) });
  if (archived.status !== "supported") return checks;
  const ghostty = await loadGhostty();
  const config = { scrollbackLimit: 8 * 1024 * 1024, fgColor: snapshot.colors.foreground, bgColor: snapshot.colors.background, cursorColor: snapshot.colors.cursor, palette: snapshot.colors.palette.slice(0, 16) };
  const replay = ghostty.createTerminal(24, 12, config);
  try {
    const restored = await restoreCore(replay, archived.value);
    record("fresh extended core replay preserves semantic styles colors links blanks and wraps", restored.status === "supported" && JSON.stringify(normalizedHistorySnapshot(replay.captureSnapshot())) === JSON.stringify(normalizedHistorySnapshot(snapshot)), { restored, primaryUnchanged: JSON.stringify(captureGhosttyNativeSnapshot(term)) === JSON.stringify(snapshot) });
  } finally { replay.free(); }
  const beforePrimary = captureGhosttyNativeSnapshot(term)!;
  await engine.write("\x1b[?1049h\x1b[2J\x1b[HALT APPLICATION\x1b[3;4H");
  const beforeAlt = captureGhosttyNativeSnapshot(term, "active")!; const primaryInAlt = captureGhosttyNativeSnapshot(term)!;
  const altArchive = term.serializeStyledHistory(); const afterAlt = captureGhosttyNativeSnapshot(term, "active")!;
  record("primary history capture leaves alternate and primary screens and cursors intact", altArchive.status === "supported" && JSON.stringify(beforeAlt) === JSON.stringify(afterAlt) && JSON.stringify(primaryInAlt) === JSON.stringify(captureGhosttyNativeSnapshot(term)) && JSON.stringify(normalizedHistorySnapshot(beforePrimary)) === JSON.stringify(normalizedHistorySnapshot(primaryInAlt)), { activeScreen: beforeAlt.screen, capturedScreen: primaryInAlt.screen, archiveStatus: altArchive.status, primaryCursor: primaryInAlt.cursor, alternateCursor: beforeAlt.cursor });
  await engine.write("\x1b[?1049l");
  const golden = ghostty.createTerminal(24, 12, config);
  try {
    golden.write(styledHistoryFixture); golden.resize(18, 10); term.resize(18, 10);
    const restored = await term.restoreStyledHistory(archived.value);
    const actual = normalizedHistorySnapshot(captureGhosttyNativeSnapshot(term)!); const expected = normalizedHistorySnapshot(golden.captureSnapshot());
    const difference = firstHistoryDifference(expected, actual);
    record("explicit saved-grid replay then current-grid resize preserves reflow semantics", restored.status === "supported" && term.cols === 18 && term.rows === 10 && difference === null, { restored, finalGrid: [term.cols, term.rows], difference, archiveDiagnostics: getGhosttyHistoryDiagnostics(term) });
  } finally { golden.free(); }
  return checks;
}
