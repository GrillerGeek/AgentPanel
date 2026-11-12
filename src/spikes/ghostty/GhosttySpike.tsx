import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { frames, type Kind } from "./engine";
import { createAdapterEngine, adapterCompatibility, adapterBenchmark, characterizeXtermUnicode, loadSelectionSearchFixture, type AdapterEngine, candidateBuild } from "./adapterHarness";
import { loadStyledHistoryFixture, logicalWrapQuery } from "./historyWrapProbes";
import { getGhosttyHistoryDiagnostics } from "../../lib/terminalRenderer/ghosttyRenderer";
import { nativeAcceptance } from "./nativeAcceptance";
import { openTerminal, type TerminalConnection } from "../../lib/terminalRuntime";
import { makeCopyPasteKeyHandler, makeContextMenuHandler, makeRightButtonGuard, type ClipboardDeps } from "../../lib/terminalClipboard";
import type { HerdrInventory, HerdrRuntime } from "../../types";
import "@xterm/xterm/css/xterm.css";
import "./spike.css";

const kinds: Kind[] = ["xterm", "ghostty"];
interface View { engine: AdapterEngine; connection?: TerminalConnection; runtime?: HerdrRuntime; ready: boolean; inputs: number; outputs: number; failed: boolean; disposed: boolean; cleanup(): void }
export default function GhosttySpike() {
  const hosts = useRef<Partial<Record<Kind, HTMLDivElement>>>({});
  const views = useRef<Partial<Record<Kind, View>>>({});
  const benchHost = useRef<HTMLDivElement>(null);
  const fixtureSearchRef = useRef<HTMLInputElement>(null);
  const [fixtureQuery, setFixtureQuery] = useState("needle 👩🏽‍💻");
  const [storedHistory, setStoredHistory] = useState("");
  const [replayGrid, setReplayGrid] = useState("18x10");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retired, setRetired] = useState(false);
  const [report, setReport] = useState<Record<string, unknown>>({ package: "AgentPanel Ghostty history metadata-ABI1 experiment", rawPackage: "ghostty-web@0.4.0", candidateBuild, userAgent: navigator.userAgent });
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("local");
  const [cwd, setCwd] = useState("/private/tmp/agentpanel-ghostty-spike");
  const [executable, setExecutable] = useState("herdr-core");
  const [session, setSession] = useState("apghostty");
  const [inventory, setInventory] = useState<HerdrInventory>();
  const [machine, setMachine] = useState("");
  const message = (key: string, value: string) => setMessages((old) => ({ ...old, [key]: value }));

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const startupQuery = new URLSearchParams(window.location.search);
      if (startupQuery.get("auto") === "1") await invoke("write_bench", { data: JSON.stringify({ progressRunId: startupQuery.get("runId"), stage: "initializing comparison renderers" }) });
      for (const kind of kinds) {
        const start = performance.now();
        const engine = await createAdapterEngine(kind, hosts.current[kind]!);
        if (disposed) { engine.dispose(); return; }
        engine.fit(); // UI panes use their visible bounds; benchmark factories keep 80×24.
        const view: View = { engine, ready: false, inputs: 0, outputs: 0, failed: false, disposed: false, cleanup() {} }; views.current[kind] = view;
        const clipboard: ClipboardDeps = { isMac: /Mac/.test(navigator.platform), readClipboard: readText,
          writeClipboard: writeText, pasteToTerminal: (text) => engine.term.paste(text), getSelection: () => { const result = engine.term.getSelection(); if (result.status !== "supported") { message(kind, result.reason); return undefined; } return result.value; },
          hasSelection: () => engine.term.hasSelection(), clearSelection: () => engine.term.clearSelection(),
          openSearch: () => fixtureSearchRef.current?.focus() };
        const handler = makeCopyPasteKeyHandler(clipboard);
        const container = hosts.current[kind]!;
        const context = makeContextMenuHandler(clipboard);
        const onContext = (event: MouseEvent) => { event.stopImmediatePropagation(); context(event); };
        const rightButton = makeRightButtonGuard(() => engine.term.isMouseTracking());
        container.addEventListener("contextmenu", onContext, true);
        container.addEventListener("mousedown", rightButton, true); container.addEventListener("mouseup", rightButton, true);
        view.cleanup = () => {
          container.removeEventListener("contextmenu", onContext, true);
          container.removeEventListener("mousedown", rightButton, true); container.removeEventListener("mouseup", rightButton, true);
        };
        // Adapters normalize false to suppress keyboard processing.
        engine.term.setKeyHandler(handler);
        engine.term.onError((error) => {
          view.failed = true; view.ready = false; message(kind, `Renderer failed: ${error.message}; reload the spike to retry`);
          const failed = view.connection; view.connection = undefined; void failed?.dispose(false);
        });
        engine.term.onData((data) => {
          view.inputs++;
          if (view.ready && view.connection) void view.connection.write(data).catch((error) => { view.ready = false; message(kind, String(error)); });
        });
        engine.term.onTitleChange((title) => message(`${kind} title`, title));
        message(kind, `${engine.renderer}; startup ${(performance.now() - start).toFixed(1)} ms; disconnected`);
      }
      if (!disposed) {
        const query = new URLSearchParams(window.location.search);
        if (query.get("auto") === "1" && await invoke<boolean>("bench_requested").catch(() => false)) {
          setBusy(true); setRetired(true);
          const engines = kinds.map((kind) => { const view = views.current[kind]!; view.cleanup(); return view.engine; });
          // Hand ownership to the acceptance runner; it disposes these surfaces.
          views.current = {};
          const result = await nativeAcceptance(benchHost.current!, engines, query);
          setReport(result); await invoke("write_bench", { data: JSON.stringify(result, null, 2) });
          message("saved", "Native acceptance complete: OS temp agentpanel_bench.json"); setBusy(false);
        } else setReady(true);
      }
    })().catch((error) => {
      message("error", String(error)); setBusy(false);
      const query = new URLSearchParams(window.location.search);
      if (query.get("auto") === "1") void invoke("write_bench", { data: JSON.stringify({
        runId: query.get("runId"), error: error instanceof Error ? error.stack : String(error),
      }) });
    });
    return () => { disposed = true; for (const view of Object.values(views.current)) {
      view.disposed = true; view.ready = false; void view.connection?.dispose(false); view.cleanup(); view.engine.dispose();
    } };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { message("error", String(error)); } finally { setBusy(false); }
  };
  const loadInventory = () => run(async () => {
    const value = await invoke<HerdrInventory>("herdr_inventory", { endpoint: { executable, session } });
    setInventory(value); setMachine(""); message("inventory", `${value.coreName}: ${value.machines.length} remote machines`);
  });
  const connect = (kind: Kind) => run(async () => {
    const view = views.current[kind]!;
    if (view.connection) return;
    if (view.failed || view.disposed) throw new Error("Renderer unavailable; reload the spike before reconnecting");
    if (!view.runtime && mode === "herdr") {
      const selected = inventory?.machines.find((m) => m.name === machine);
      if (machine && (!selected || selected.state !== "connected")) throw new Error("Refresh and select a connected remote machine");
      view.runtime = { kind: "herdr", executable, session, key: crypto.randomUUID().replaceAll("-", ""),
        ...(selected ? { target: { endpoint: { executable, session }, coreId: inventory!.coreId,
          machine: selected.name, machineId: selected.coreId, session: selected.session } } : {}) };
    }
    await view.engine.term.whenIdle(); view.engine.term.reset();
    const requested = view.runtime ? { ...view.runtime } : undefined;
    if (view.runtime?.target) view.runtime.existingOnly = true;
    const connection = await openTerminal({ runtime: requested, cwd, shell: "/bin/sh", env: null,
      rows: view.engine.term.rows, cols: view.engine.term.cols,
      output: (data, consumed) => {
        view.outputs++;
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        view.engine.term.write(bytes, consumed);
      }, status: (state) => message(`${kind} status`, state ?? "not reported"),
      closed: (code) => { view.ready = false; message(kind, `exited ${code}`); },
      disconnected: (error) => { view.ready = false; message(kind, error); },
      binding: (binding) => { if (view.runtime) view.runtime.binding = binding; },
    });
    if (view.failed || view.disposed) { await connection.dispose(false); return; }
    view.connection = connection; view.ready = true;
    message(kind, `connected ${view.runtime?.binding?.address ?? "local PTY"}; ${view.engine.renderer}`);
  });
  const disconnect = (kind: Kind) => run(async () => {
    const view = views.current[kind]!; view.ready = false;
    await view.connection?.dispose(false); view.connection = undefined;
    message(kind, "disconnected (Herdr detaches; local PTY stops)");
  });
  const probe = () => run(async () => {
    const results: Record<string, unknown> = {};
    for (const kind of kinds) {
      const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; benchHost.current!.append(target);
      const engine = await createAdapterEngine(kind, target);
      try { results[kind] = await adapterCompatibility(engine); }
      finally { engine.dispose(); target.remove(); }
    }
    const baseline = await characterizeXtermUnicode(benchHost.current!);
    setReport((old) => ({ ...old, adapterCompatibility: results, xtermUnicodeBaseline: baseline }));
  });
  const loadFixture = () => run(async () => {
    if (Object.values(views.current).some((view) => view.connection)) throw new Error("Disconnect before loading synthetic output");
    for (const kind of kinds) { const engine = views.current[kind]!.engine; engine.fit(); await loadSelectionSearchFixture(engine); }
    setFixtureQuery("needle 👩🏽‍💻");
    message("fixture", "Loaded 120 controlled Unicode rows, with two needle matches. Selection clears when output or the cell grid changes.");
  });
  const searchFixture = (kind: Kind, previous = false) => {
    const engine = views.current[kind]!.engine;
    const result = engine.term.search(fixtureQuery, previous);
    message(`${kind} search`, JSON.stringify({ result, selection: engine.term.getSelection(), presentation: engine.selectionPresentation?.() }));
  };
  const loadStyledFixture = () => run(async () => {
    if (Object.values(views.current).some((view) => view.connection)) throw new Error("Disconnect before loading synthetic output");
    for (const kind of kinds) await loadStyledHistoryFixture(views.current[kind]!.engine);
    setFixtureQuery(logicalWrapQuery); message("fixture", "Loaded styled primary history with a linked Unicode query across logical wraps and explicit black backgrounds.");
  });
  const captureHistory = () => run(async () => {
    const engine = views.current.ghostty!.engine;
    if (views.current.ghostty!.connection) throw new Error("Disconnect before history review");
    await engine.term.whenIdle(); const result = engine.term.serializeStyledHistory();
    if (result.status !== "supported") throw new Error(result.reason);
    if (!result.value) throw new Error("No meaningful history captured; previous archive preserved");
    setStoredHistory(result.value);
    const review = { bytes: new TextEncoder().encode(result.value).length, diagnostics: getGhosttyHistoryDiagnostics(engine.term) };
    setReport((old) => ({ ...old, styledHistoryCapture: review })); message("history", JSON.stringify(review));
  });
  const replayHistory = () => run(async () => {
    const engine = views.current.ghostty!.engine;
    if (views.current.ghostty!.connection) throw new Error("Disconnect before history replay");
    const [cols, rows] = replayGrid.split("x").map(Number); engine.term.resize(cols, rows);
    const result = await engine.term.restoreStyledHistory(storedHistory);
    if (result.status !== "supported") throw new Error(result.reason);
    engine.term.search(fixtureQuery); await frames();
    const review = { requestedGrid: [cols, rows], finalGrid: [engine.term.cols, engine.term.rows], selected: engine.term.getSelection(), presentation: engine.selectionPresentation?.() };
    setReport((old) => ({ ...old, styledHistoryReplay: review })); message("history", "Replayed primary history at the saved grid, then reflowed to the selected review grid.");
  });
  const connected = Object.values(views.current).some((v) => v.connection);
  const bound = Object.values(views.current).some((v) => v.runtime);
  return <main className="ghostty-spike">
    <h1>Ghostty feasibility spike</h1>
    <p>Candidate: AgentPanel metadata ABI1 extension; raw ghostty-web0.4.0 remains the historical reference. Experimental comparison only. No saved repositories or normal terminal preferences are used. xterm remains the product default.</p>
    <section className="spike-controls">
      <label>Connection <select value={mode} disabled={connected || bound || busy} onChange={(e) => setMode(e.target.value)}>
        <option value="local">Local PTY</option><option value="herdr">Herdr core</option></select></label>
      <label>Scratch working directory <input value={cwd} disabled={connected || bound || busy} onChange={(e) => setCwd(e.target.value)} /></label>
      {mode === "herdr" && <>
        <label>Core executable <input value={executable} disabled={connected || bound || busy} onChange={(e) => { setExecutable(e.target.value); setInventory(undefined); }} /></label>
        <label>Dedicated session <input value={session} disabled={connected || bound || busy} onChange={(e) => { setSession(e.target.value); setInventory(undefined); }} /></label>
        <button disabled={connected || bound || busy} onClick={loadInventory}>Load machines</button>
        <label>Machine <select value={machine} disabled={connected || bound || busy} onChange={(e) => setMachine(e.target.value)}>
          <option value="">This computer</option>{inventory?.machines.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.state}</option>)}
        </select></label>
      </>}
    </section>
    <section className="spike-actions">
      <button disabled={connected || busy} onClick={() => {
        for (const view of Object.values(views.current)) view.runtime = undefined;
        message("binding", "Cleared spike bindings. Detached Herdr programs keep running; choose the next target explicitly.");
      }}>Clear bindings for new target</button>
      <button disabled={!ready || busy || connected} onClick={probe}>Run adapter capability probes</button>
      <button disabled={!ready || busy || connected} onClick={() => run(async () => {
        // Dispose comparison surfaces so each sample has one live render loop.
        // Reload explicitly after measurement to recreate interactive viewers.
        for (const kind of kinds) { views.current[kind]!.cleanup(); views.current[kind]!.engine.dispose(); delete views.current[kind]; }
        setReady(false); setRetired(true);
        const result = await adapterBenchmark(benchHost.current!); setReport((old) => ({ ...old, benchmark: result }));
      })}>Run adapter benchmark</button>
      <button disabled={busy} onClick={() => window.location.reload()}>Reload spike</button>
      <button disabled={busy} onClick={() => run(async () => { await invoke("write_bench", { data: JSON.stringify(report, null, 2) }); message("saved", "Saved synthetic results to the OS temp directory: agentpanel_bench.json"); })}>Save synthetic results to temp</button>
      <button disabled={busy} onClick={() => setReport((old) => ({ ...old, transport: Object.fromEntries(kinds.map((kind) => { const v = views.current[kind];
        return [kind, v ? { inputs: v.inputs, outputChunks: v.outputs, binding: v.runtime?.binding, target: v.runtime?.target?.machine } : null]; })) }))}>Record transport counters</button>
    </section>
    <section className="spike-actions" aria-label="Controlled selection and search fixture">
      <button disabled={!ready || busy || connected} onClick={loadFixture}>Load Unicode and scrollback fixture</button>
      <label>Fixture search <input ref={fixtureSearchRef} value={fixtureQuery} disabled={!ready || busy || connected}
        onChange={(event) => setFixtureQuery(event.currentTarget.value)} /></label>
    </section>
    <section className="spike-actions" aria-label="Styled history and logical wraps">
      <button disabled={!ready || busy || connected} onClick={loadStyledFixture}>Load styled history and logical wraps</button>
      <button disabled={!ready || busy || connected} onClick={captureHistory}>Capture ghostty history</button>
      <label>Replay grid <select value={replayGrid} disabled={!ready || busy || connected} onChange={(event) => setReplayGrid(event.currentTarget.value)}>
        <option value="18x10">18 × 10</option><option value="36x12">36 × 12</option>
      </select></label>
      <button disabled={!ready || busy || connected || !storedHistory} onClick={replayHistory}>Replay ghostty history</button>
    </section>
    <div role="status">{busy ? "Running…" : retired ? "Benchmark complete; reload for interactive tests" : ready ? "Ready" : "Loading emulators…"} {Object.entries(messages).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</div>
    <div className="spike-panes">{kinds.map((kind) => <section key={kind}>
      <h2>{kind === "ghostty" ? "Ghostty extended · metadata ABI1 · Canvas" : "xterm.js 5.5 · WebGL"}</h2>
      <div className="spike-actions"><button disabled={!ready || busy} onClick={() => connect(kind)}>Connect {kind}</button>
        <button disabled={!ready || busy} onClick={() => disconnect(kind)}>Disconnect {kind}</button>
        <button disabled={!ready || busy} onClick={() => { const v = views.current[kind]!; v.engine.fit(); void v.connection?.resize(v.engine.term.rows, v.engine.term.cols); }}>Fit {kind}</button>
        <button disabled={!ready || busy} onClick={() => views.current[kind]!.engine.term.focus()}>Focus {kind}</button></div>
      <div className="spike-actions">
        <button disabled={!ready || busy || connected} onClick={() => searchFixture(kind, true)}>Previous {kind} match</button>
        <button disabled={!ready || busy || connected} onClick={() => searchFixture(kind)}>Next {kind} match</button>
        <button disabled={!ready || busy || connected} onClick={() => { views.current[kind]!.engine.term.clearSearch(); message(`${kind} search`, "Search highlight cleared"); }}>Clear {kind} search</button>
        <button disabled={!ready || busy || connected} onClick={() => {
          const engine = views.current[kind]!.engine;
          setReport((old) => ({ ...old, [`${kind}SelectionReview`]: { selected: engine.term.getSelection(), presentation: engine.selectionPresentation?.() } }));
        }}>Inspect {kind} selection</button>
      </div>
      <div className="spike-terminal" ref={(node) => { if (node) hosts.current[kind] = node; }} />
    </section>)}</div>
    <div ref={benchHost} className="spike-bench" />
    <label>Synthetic results JSON<textarea readOnly value={JSON.stringify(report, null, 2)} rows={12} /></label>
  </main>;
}
