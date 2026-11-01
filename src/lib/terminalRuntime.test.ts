import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openTerminal, startInitialCommand } from "./terminalRuntime";

const channels = vi.hoisted(() => [] as Array<{ onmessage: (event: unknown) => void }>);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {
  onmessage = (_: unknown) => {};
  constructor() { channels.push(this); }
} }));

const binding = { coreId: "core-A", address: "t1" };
const runtime = { kind: "herdr" as const, key: "a".repeat(32), executable: "/hc", session: "agentpanel", binding };
const options = () => ({ runtime, cwd: "/repo", shell: "", env: null, rows: 24, cols: 80,
  output: vi.fn(), status: vi.fn(), closed: vi.fn(), disconnected: vi.fn(), binding: vi.fn() });

beforeEach(() => { channels.length = 0; vi.mocked(invoke).mockReset(); });

describe("persistent terminal transport", () => {
  it("detaches imported terminals even when generic teardown requests termination", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 8, created: false, binding });
    const session = await openTerminal({ ...options(), runtime: { ...runtime, attachOnly: true } });
    await session.dispose(true);
    expect(invoke).toHaveBeenCalledWith("herdr_detach", { id: 8 });
    expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
  });
  it("uses saved identity and returns output credit only after the renderer consumes it", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 7, created: false, binding });
    const opts = options();
    const session = await openTerminal(opts);
    expect(invoke).toHaveBeenCalledWith("herdr_open", expect.objectContaining({
      options: expect.objectContaining({ binding, cwd: "/repo", key: runtime.key }),
    }));
    channels[0].onmessage({ kind: "output", data: "aGk=", bytes: 2 });
    expect(invoke).not.toHaveBeenCalledWith("herdr_ack", expect.anything());
    opts.output.mock.calls[0][1]();
    expect(invoke).toHaveBeenCalledWith("herdr_ack", { id: 7, bytes: 2 });
    await startInitialCommand(session, "codex");
    expect(invoke).not.toHaveBeenCalledWith("herdr_write", expect.anything());
    await session.dispose(false);
    expect(invoke).toHaveBeenCalledWith("herdr_detach", { id: 7 });
    expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
  });

  it("buffers an acknowledgement that arrives before the open response", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const opts = options();
    const opened = openTerminal(opts);
    channels[0].onmessage({ kind: "output", data: "aGk=", bytes: 2 });
    opts.output.mock.calls[0][1]();
    resolve({ id: 8, created: true, binding });
    await opened;
    expect(invoke).toHaveBeenCalledWith("herdr_ack", { id: 8, bytes: 2 });
  });

  it("only submits quick launch for a newly created terminal and explicitly terminates on request", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 9, created: true, binding });
    const session = await openTerminal(options());
    await startInitialCommand(session, "claude");
    expect(invoke).toHaveBeenCalledWith("herdr_write", { id: 9, data: "claude\r" });
    await session.dispose(true);
    expect(invoke).toHaveBeenCalledWith("herdr_terminate", { id: 9 });
    expect(invoke).toHaveBeenLastCalledWith("herdr_detach", { id: 9 });
  });

  it("does not discard the viewer when termination is unconfirmed", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 9, created: false, binding });
    const session = await openTerminal(options());
    vi.mocked(invoke).mockRejectedValueOnce("unconfirmed stop");
    await expect(session.dispose(true)).rejects.toBe("unconfirmed stop");
    expect(invoke).not.toHaveBeenCalledWith("herdr_detach", expect.anything());
  });

  it("keeps disconnects separate from process exits", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 9, created: false, binding });
    const opts = options(); await openTerminal(opts);
    channels[0].onmessage({ kind: "disconnected", message: "connection lost" });
    expect(opts.disconnected).toHaveBeenCalledWith("connection lost");
    expect(opts.closed).not.toHaveBeenCalled();
    channels[0].onmessage({ kind: "status", state: null });
    expect(opts.status).toHaveBeenCalledWith(null);
  });

  it("does not silently fall back to a new local shell after a runtime failure", async () => {
    vi.mocked(invoke).mockRejectedValue("missing core");
    await expect(openTerminal(options())).rejects.toBe("missing core");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("pty_spawn", expect.anything());
  });

  it("retains the default local PTY command path", async () => {
    vi.mocked(invoke).mockResolvedValue(10);
    const session = await openTerminal({ ...options(), runtime: undefined });
    await session.write("echo hi\r"); await session.resize(30, 90); await session.dispose(false);
    expect(invoke).toHaveBeenCalledWith("pty_write", { id: 10, data: "echo hi\r" });
    expect(invoke).toHaveBeenCalledWith("pty_resize", { id: 10, rows: 30, cols: 90 });
    expect(invoke).toHaveBeenCalledWith("pty_close", { id: 10 });
  });
});
