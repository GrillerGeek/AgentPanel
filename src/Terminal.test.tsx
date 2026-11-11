// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ state: {} as any, term: {} as any, open: vi.fn(), initial: vi.fn(), factory: vi.fn(), invoke: vi.fn(), output: undefined as any, failure: undefined as any }));
vi.mock("./state/store", () => ({ useStore: Object.assign((selector: any) => selector(mocks.state), { getState: () => mocks.state }) }));
vi.mock("./lib/terminalRenderer/xtermRenderer", () => ({ createXtermRenderer: mocks.factory }));
vi.mock("./lib/terminalRuntime", () => ({ openTerminal: mocks.open, startInitialCommand: mocks.initial }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("./state/agentRuntime", () => ({ noteOutput: vi.fn(), noteExit: vi.fn(), forgetPane: vi.fn(), noteRuntimeState: vi.fn(), reportedState: (value: any) => value }));
import { TerminalPane } from "./Terminal";
import { livePaneIds, snapshotAll } from "./lib/scrollbackRegistry";
const connection = () => ({ id: 10, created: true, write: vi.fn(async () => {}), resize: vi.fn(async () => {}), dispose: vi.fn(async () => {}) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.state = { settings: { shell: "/bin/sh", terminalEnv: "", syncLoginPath: false, pathSyncHintShown: true, theme: "tokyo-night", webgl: true, fontFamily: "Menlo", fontSize: 14, persistScrollback: true },
    setPaneSession: vi.fn(), inheritTabTitle: vi.fn(), pushToast: vi.fn(), updateSettings: vi.fn(), terminals: [{ panes: [{ id: "pane" }] }], confirmState: null };
  mocks.term = { cols: 80, rows: 24, capabilities: { styledHistory: "supported" }, write: vi.fn(), whenIdle: vi.fn(async () => {}), fit: vi.fn(), paste: vi.fn(),
    getSelection: vi.fn(() => ({ status: "supported", value: "" })), hasSelection: vi.fn(() => false), clearSelection: vi.fn(), setKeyHandler: vi.fn(), isMouseTracking: vi.fn(() => false),
    onData: vi.fn(() => ({ dispose: vi.fn() })), onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
    onError: vi.fn((listener) => { mocks.failure = listener; return { dispose: vi.fn() }; }),
    serializeStyledHistory: vi.fn(() => ({ status: "supported", value: "\x1b[31mhistory" })), setAppearance: vi.fn(), setVisibility: vi.fn(), search: vi.fn(), clearSearch: vi.fn(), focus: vi.fn(), dispose: vi.fn() };
  mocks.factory.mockReturnValue(mocks.term); mocks.invoke.mockImplementation(async (command: string) => command === "scrollback_load" ? "saved ANSI" : undefined);
  mocks.open.mockImplementation(async (options) => { mocks.output = options.output; return connection(); }); mocks.initial.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
describe("TerminalPane renderer boundary", () => {
  it("finishes saved ANSI and restore banner before capture registration and shell spawn", async () => {
    let parsed!: () => void; mocks.term.whenIdle.mockReturnValue(new Promise<void>((resolve) => { parsed = resolve; }));
    render(<TerminalPane paneId="pane" initialCommand="launch" />); await settle();
    expect(mocks.term.write.mock.calls.map(([value]: any[]) => value)).toEqual(["saved ANSI", expect.stringContaining("restored from your last session")]);
    expect(mocks.open).not.toHaveBeenCalled(); expect(livePaneIds()).toEqual([]);
    await act(async () => { parsed(); }); await settle();
    expect(mocks.open).toHaveBeenCalledOnce(); expect(livePaneIds()).toEqual(["pane"]); expect(mocks.initial).toHaveBeenCalledWith(expect.anything(), "launch");
    expect(snapshotAll()).toEqual([{ paneId: "pane", data: "\x1b[31mhistory" }]);
  });
  it("live appearance, theme and visibility changes preserve renderer and attachment", async () => {
    const view = render(<TerminalPane paneId="pane" active />); await settle();
    mocks.state.settings.fontSize = 18; mocks.state.settings.theme = "dracula";
    view.rerender(<TerminalPane paneId="pane" active={false} />); await settle();
    expect(mocks.factory).toHaveBeenCalledOnce(); expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.term.setAppearance).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18 }));
    expect(mocks.term.setVisibility).toHaveBeenLastCalledWith(false, true);
  });
  it("does not register or save an unsupported history result", async () => {
    mocks.term.capabilities.styledHistory = "unsupported";
    mocks.term.serializeStyledHistory.mockReturnValue({ status: "unsupported", reason: "no replayable ANSI" });
    const view = render(<TerminalPane paneId="pane" />); await settle(); expect(livePaneIds()).toEqual([]);
    view.unmount(); expect(mocks.invoke.mock.calls.filter(([command]: any[]) => command === "scrollback_save")).toEqual([]);
  });
  it("handles fatal parse failure before open resolves by detaching the eventual attachment without initial command", async () => {
    let opened!: (value: any) => void; const session = connection();
    mocks.open.mockImplementation(() => new Promise((resolve) => { opened = resolve; }));
    render(<TerminalPane paneId="pane" initialCommand="do-not-replay" />); await settle();
    act(() => { mocks.failure(new Error("parse failed during open")); });
    await act(async () => { opened(session); }); await settle();
    expect(session.dispose).toHaveBeenCalledExactlyOnceWith(false); expect(mocks.initial).not.toHaveBeenCalled(); expect(mocks.state.setPaneSession).not.toHaveBeenCalled();
  });
  it("forwards original bytes and exact consumed callback to the adapter", async () => {
    render(<TerminalPane paneId="pane" />); await settle(); const consumed = vi.fn();
    mocks.output(btoa("raw\x1b[31m"), consumed);
    expect(mocks.term.write).toHaveBeenLastCalledWith(Uint8Array.from([114, 97, 119, 27, 91, 51, 49, 109]), consumed); expect(consumed).not.toHaveBeenCalled();
  });
});
