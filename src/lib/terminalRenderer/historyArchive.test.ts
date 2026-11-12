import { describe, expect, it, vi } from "vitest";
import { HISTORY_BYTE_LIMIT, historyHeader, parseHistoryArchive, StyledHistoryRestorer } from "./historyArchive";
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  let grid = { cols: 6, rows: 3 }; let visible = true; let finish!: () => void;
  const idle = vi.fn(async () => {}); const resize = vi.fn((cols: number, rows: number) => { grid = { cols, rows }; });
  const write = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })); const reset = vi.fn();
  const fit = vi.fn(() => { grid = { cols: 12, rows: 7 }; });
  const restorer = new StyledHistoryRestorer({ grid: () => ({ ...grid }), resize, fit, canFit: () => visible, idle, write, reset });
  return { restorer, idle, resize, write, reset, fit, grid: () => grid, complete: () => finish(), visible: (value: boolean) => { visible = value; } };
}
describe("explicit stored history contract", () => {
  it("validates only canonical beginning headers and leaves legacy/embedded markers untouched", () => {
    expect(parseHistoryArchive("old ANSI")).toEqual({ status: "supported", value: { kind: "legacy", body: "old ANSI" } });
    expect(parseHistoryArchive(historyHeader(8, 4) + "body")).toEqual({ status: "supported", value: { kind: "versioned", grid: { cols: 8, rows: 4 }, body: "body" } });
    expect(parseHistoryArchive("prefix" + historyHeader(8, 4))).toMatchObject({ status: "supported", value: { kind: "legacy" } });
    for (const text of ["\x1b]777;AgentPanelHistory", "\x1b]777;AgentPanelHist", "\x1b]777;AgentPanelHistory;2;8;4\x1b\\", "\x1b]777;AgentPanelHistory;1;08;4\x1b\\", "\x1b]777;AgentPanelHistory;1;0;4\x1b\\", "\x1b]777;AgentPanelHistory;1;4097;4\x1b\\", "\x1b]777;AgentPanelHistory;1;4096;4096\x1b\\", "\x1b]777;AgentPanelHistory;" + "a".repeat(100) + "\x1b\\"]) expect(parseHistoryArchive(text).status).toBe("unsupported");
    expect(parseHistoryArchive("é".repeat(HISTORY_BYTE_LIMIT)).status).toBe("unsupported");
  });
  it("replays at saved dimensions, then applies the latest explicit resize", async () => {
    const s = fixture(); const result = s.restorer.restore(historyHeader(8, 4) + "body"); await tick();
    expect(s.grid()).toEqual({ cols: 8, rows: 4 }); expect(s.write).toHaveBeenCalledExactlyOnceWith("body");
    s.restorer.resize(7, 5); s.restorer.resize(9, 6); expect(s.grid()).toEqual({ cols: 8, rows: 4 });
    s.complete(); expect(await result).toEqual({ status: "supported", value: undefined }); expect(s.grid()).toEqual({ cols: 9, rows: 6 });
  });
  it("defers visible fit until parsed completion, and a later resize overrides it", async () => {
    const s = fixture(); let result = s.restorer.restore(historyHeader(8, 4) + "body"); await tick(); s.restorer.fit(); expect(s.fit).not.toHaveBeenCalled();
    s.complete(); await result; expect(s.grid()).toEqual({ cols: 12, rows: 7 });
    result = s.restorer.restore(historyHeader(8, 4) + "body"); await tick(); s.restorer.fit(); s.restorer.resize(10, 8); s.complete(); await result; expect(s.grid()).toEqual({ cols: 10, rows: 8 });
  });
  it("does not fit a hidden0x0 surface or corrupt desired geometry", async () => {
    const s = fixture(); const result = s.restorer.restore(historyHeader(8, 4) + "body"); await tick(); s.restorer.resize(9, 5); s.restorer.fit(); s.visible(false); s.restorer.fit();
    s.complete(); await result; expect(s.fit).not.toHaveBeenCalled(); expect(s.grid()).toEqual({ cols: 9, rows: 5 });
  });
  it("invalid headers cause no mutation; legacy writes complete before success", async () => {
    const s = fixture(); expect((await s.restorer.restore("\x1b]777;AgentPanelHistory;99;8;4\x1b\\bad")).status).toBe("unsupported");
    expect(s.idle).not.toHaveBeenCalled(); expect(s.resize).not.toHaveBeenCalled(); expect(s.write).not.toHaveBeenCalled();
    const result = s.restorer.restore("old ANSI"); await tick(); expect(s.write).toHaveBeenCalledWith("old ANSI"); expect(s.resize).not.toHaveBeenCalled(); s.complete(); await result;
  });
  it("recovers reset/desired geometry best-effort on runtime failure without pretending rollback", async () => {
    const s = fixture(); s.write.mockRejectedValue(new Error("parse failed"));
    const result = await s.restorer.restore(historyHeader(8, 4) + "bad"); expect(result).toMatchObject({ status: "unsupported", reason: expect.stringContaining("partial replay") });
    expect(s.reset).toHaveBeenCalledTimes(2); expect(s.grid()).toEqual({ cols: 6, rows: 3 });
  });
  it("does not mutate a disposed target or allow concurrent restores", async () => {
    const s = fixture(); const pending = s.restorer.restore(historyHeader(8, 4) + "body"); await tick();
    expect((await s.restorer.restore("other")).status).toBe("unsupported"); s.restorer.dispose(); s.complete(); expect((await pending).status).toBe("unsupported");
    expect(s.resize).toHaveBeenCalledTimes(1); expect(s.reset).toHaveBeenCalledTimes(1); s.restorer.resize(99, 99); s.restorer.fit(); expect(s.resize).toHaveBeenCalledTimes(1);
  });
});
