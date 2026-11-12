import { invoke } from "@tauri-apps/api/core";
import type { HerdrInventory, HerdrRuntime } from "../../types";
import { openTerminal, type TerminalConnection } from "../../lib/terminalRuntime";
import { createEngine, type Engine, type Kind } from "./engine";
import { benchmark, compatibility } from "./probes";
import { createAdapterEngine, adapterCompatibility, adapterBenchmark, characterizeXtermUnicode, type AdapterEngine, candidateBuild } from "./adapterHarness";

async function until(test: () => boolean, label: string) {
  const end = performance.now() + 20000;
  while (!test()) {
    if (performance.now() > end) throw new Error(`Deadline: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function transport(engine: Engine | AdapterEngine, cwd: string, runtime?: HerdrRuntime) {
  let connection: TerminalConnection | undefined;
  let ready = false;
  let bytes = 0; let credits = 0; let tail = "";
  const decoder = new TextDecoder();
  const errors: string[] = [];
  let rendererFailed = false;
  const rendererError = engine.consumption === "adapter" ? (engine as AdapterEngine).term.onError((error) => {
    rendererFailed = true; ready = false; errors.push(error.message);
    const failed = connection; connection = undefined; void failed?.dispose(false);
  }) : undefined;
  const input = engine.term.onData((data) => { if (ready && connection) void connection.write(data).catch((error) => errors.push(String(error))); });
  const attach = async () => {
    if (engine.consumption === "adapter") await (engine as AdapterEngine).term.whenIdle();
    engine.term.reset();
    connection = await openTerminal({ runtime, cwd, shell: "/bin/sh", env: null, rows: engine.term.rows, cols: engine.term.cols,
      output: (chunk, consumed) => {
        const data = Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0));
        bytes += data.length; tail = (tail + decoder.decode(data, { stream: true })).slice(-8192);
        const parsed = () => { credits += data.length; consumed(); };
        if (engine.consumption === "adapter") (engine as AdapterEngine).term.write(data, parsed);
        else void engine.write(data).then(parsed).catch((error) => errors.push(String(error)));
      }, status: () => {}, closed: () => { ready = false; }, disconnected: (error) => { ready = false; errors.push(error); },
      binding: (binding) => { if (runtime) runtime.binding = binding; },
    });
    if (rendererFailed) { await connection.dispose(false); connection = undefined; throw new Error("Renderer failed while opening"); }
    ready = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const pid = async () => {
    tail = ""; engine.term.paste("printf '\\nGHOSTTY-PID:%s:END\\n' \"$$\"\n");
    await until(() => /\r?\nGHOSTTY-PID:\d+:END/.test(tail), "shell PID reply");
    const pid = Number(tail.match(/GHOSTTY-PID:(\d+):END/)![1]);
    await until(() => engine.text().includes(`GHOSTTY-PID:${pid}:END`), "rendered PID in screen buffer");
    return pid;
  };
  try {
    await attach();
    const originalPid = await pid();
    const before = bytes;
    engine.term.paste("dd if=/dev/zero bs=1024 count=300 2>/dev/null | tr '\\000' x; printf '\\nFLOOD-%s-END\\n' COMPLETE\n");
    await until(() => tail.includes("\r\nFLOOD-COMPLETE-END\r\n"), "PTY output beyond initial Herdr credit");
    await until(() => credits === bytes, "consumed output credit");
    if (bytes - before < 300 * 1024) throw new Error("Flood output truncated");
    engine.term.resize(101, 37); await connection!.resize(37, 101); tail = "";
    engine.term.paste("stty size; printf '\\nRESIZE-%s-END\\n' COMPLETE\n");
    await until(() => tail.includes("37 101"), "real PTY resize");
    let resumedPid: number | undefined;
    if (runtime) {
      ready = false; await connection!.dispose(false); connection = undefined;
      runtime.existingOnly = true;
      await attach();
      if (connection!.created) throw new Error("Reattach created a replacement program");
      resumedPid = await pid();
      if (resumedPid !== originalPid) throw new Error("Reattach changed process identity");
    }
    if (errors.length) throw new Error(errors.join("; "));
    return { kind: engine.kind, consumption: engine.consumption, result: "pass", runtime: runtime ? (runtime.target ? "Herdr SSH" : "Herdr local") : "Local PTY",
      pid: originalPid, resumedPid, bytes, consumedBytes: credits, binding: runtime?.binding, floodBytesAtLeast: 300 * 1024, resize: "37x101", rawByteOutput: true };
  } finally {
    ready = false; input.dispose(); rendererError?.dispose(); await connection?.dispose(!runtime);
  }
}

export async function nativeAcceptance(host: HTMLElement, comparison: Array<{ dispose(): void }>, options: URLSearchParams) {
  const output: Record<string, unknown> = { runId: options.get("runId"), package: "AgentPanel Ghostty history metadata-ABI1 experiment", rawPackage: "ghostty-web@0.4.0", candidateBuild, userAgent: navigator.userAgent,
    mode: "automated native Tauri/WebKit acceptance; not manual UI/IME or real-agent approval acceptance" };
  for (const engine of comparison) engine.dispose();
  const progress = (stage: string) => invoke("write_bench", { data: JSON.stringify({ progressRunId: options.get("runId"), stage }) });
  await progress("raw benchmark");
  const rawBenchmark = await benchmark(host, ({ kind, consumption, round, stage }) => progress(`raw benchmark round${round} ${kind} ${consumption}: ${stage}`));
  output.benchmark = rawBenchmark;
  const rawFailure = rawBenchmark.results.find((row) => typeof row === "object" && row !== null && "error" in row);
  if (rawFailure) throw new Error(`Raw benchmark failed: ${JSON.stringify(rawFailure)}`);
  await progress("adapter benchmark");
  output.adapterBenchmark = await adapterBenchmark(host);
  await progress("xterm baseline");
  output.xtermUnicodeBaseline = await characterizeXtermUnicode(host);
  const executable = options.get("hc"); const session = options.get("session") ?? "agentpanel-adapter-test";
  const cwd = options.get("cwd") ?? "/private/tmp/agentpanel-ghostty-spike";
  const transports: unknown[] = []; const compatible: Record<string, unknown> = {};
  let inventory: HerdrInventory | undefined;
  if (executable) inventory = await invoke<HerdrInventory>("herdr_inventory", { endpoint: { executable, session } });
  const cases: Array<{ kind: Kind; consumption: Engine["consumption"] }> = [
    { kind: "xterm", consumption: "library-callback" }, { kind: "ghostty", consumption: "library-callback" },
    { kind: "ghostty", consumption: "parse-return" },
  ];
  for (const { kind, consumption } of cases) {
    await progress(`raw transport ${kind} ${consumption}`);
    const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
    const engine = await createEngine(kind, target, true, consumption);
    try {
      const modes: Array<{ cwd: string; runtime?: HerdrRuntime }> = [{ cwd }];
      if (executable && inventory) {
        const make = (): HerdrRuntime => ({ kind: "herdr", executable, session, key: crypto.randomUUID().replaceAll("-", "") });
        modes.push({ cwd, runtime: make() });
        const machine = inventory.machines.find((m) => m.name === "linux" && m.state === "connected");
        if (!machine) throw new Error("Disposable linux SSH machine not connected");
        modes.push({ cwd: "/home/agentpanel/project", runtime: { ...make(), target: { endpoint: { executable, session }, coreId: inventory.coreId,
          machine: machine.name, machineId: machine.coreId, session: machine.session } } });
      }
      for (const mode of modes) {
        try { transports.push(await transport(engine, mode.cwd, mode.runtime)); }
        catch (error) { transports.push({ kind, consumption, runtime: mode.runtime?.target ? "Herdr SSH" : mode.runtime ? "Herdr local" : "Local PTY", result: "fail", error: String(error) }); }
      }
    } finally { try { engine.dispose(); } catch { /* recorded compatibility failures */ } target.remove(); }
  }
  const adapterTransports: unknown[] = []; const adapterChecks: Record<string, unknown> = {};
  for (const kind of ["xterm", "ghostty"] as Kind[]) {
    await progress(`adapter transport ${kind}`);
    const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
    const engine = await createAdapterEngine(kind, target);
    try {
      const modes: Array<{ cwd: string; runtime?: HerdrRuntime }> = [{ cwd }];
      if (executable && inventory) {
        const make = (): HerdrRuntime => ({ kind: "herdr", executable, session, key: crypto.randomUUID().replaceAll("-", "") });
        modes.push({ cwd, runtime: make() });
        const machine = inventory.machines.find((m) => m.name === "linux" && m.state === "connected");
        if (!machine) throw new Error("Disposable linux SSH machine not connected");
        modes.push({ cwd: "/home/agentpanel/project", runtime: { ...make(), target: { endpoint: { executable, session }, coreId: inventory.coreId,
          machine: machine.name, machineId: machine.coreId, session: machine.session } } });
      }
      for (const mode of modes) {
        try { adapterTransports.push(await transport(engine, mode.cwd, mode.runtime)); }
        catch (error) { adapterTransports.push({ kind, consumption: "adapter", result: "fail", runtime: mode.runtime?.target ? "Herdr SSH" : mode.runtime ? "Herdr local" : "Local PTY", error: String(error) }); }
      }
    } finally { engine.dispose(); target.remove(); }
    // Compatibility starts from a fresh renderer; terminal.reset() is not a
    // guarantee that a wrapper has released all history from transport floods.
    const probeTarget = document.createElement("div"); probeTarget.style.cssText = "width:800px;height:420px"; host.append(probeTarget);
    const probeEngine = await createAdapterEngine(kind, probeTarget);
    await progress(`adapter compatibility ${kind}`);
    try { adapterChecks[kind] = await adapterCompatibility(probeEngine); }
    finally { probeEngine.dispose(); probeTarget.remove(); }
  }
  output.adapterTransport = adapterTransports; output.adapterCompatibility = adapterChecks;
  // Probe unsupported addons only after every transport sample has finished.
  for (const kind of ["xterm", "ghostty"] as Kind[]) {
    await progress(`raw compatibility ${kind}`);
    const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
    const engine = await createEngine(kind, target);
    try { compatible[kind] = await compatibility(engine); }
    finally { try { engine.dispose(); } catch { /* recorded incompatibility */ } target.remove(); }
  }
  output.transport = transports; output.compatibility = compatible;
  return output;
}
