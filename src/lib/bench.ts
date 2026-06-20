import { invoke, Channel } from "@tauri-apps/api/core";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 100) / 100;
}

/** Keystroke→echo round-trip latency: write single bytes to a dedicated PTY and
 *  time until the shell's echo comes back through the Channel. */
async function inputLatency(samples = 200): Promise<{ p50: number; p95: number; max: number; n: number }> {
  let resolveEcho: ((t: number) => void) | null = null;
  const onOutput = new Channel<string>();
  onOutput.onmessage = () => {
    if (resolveEcho) {
      const r = resolveEcho;
      resolveEcho = null;
      r(performance.now());
    }
  };
  const id = await invoke<number>("pty_spawn", { cwd: null, rows: 24, cols: 80, shell: null, onOutput });
  await new Promise((r) => setTimeout(r, 1200)); // let the prompt finish printing

  const lat: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const echo = await new Promise<number>((res) => {
      resolveEcho = res;
      void invoke("pty_write", { id, data: "x" });
      setTimeout(() => {
        if (resolveEcho === res) {
          resolveEcho = null;
          res(performance.now());
        }
      }, 500);
    });
    lat.push(echo - t0);
    await new Promise((r) => setTimeout(r, 12));
  }
  await invoke("pty_close", { id });
  lat.sort((a, b) => a - b);
  return { p50: percentile(lat, 50), p95: percentile(lat, 95), max: percentile(lat, 100), n: lat.length };
}

/** Spawn 25 PTYs and measure total spawn time + the worst main-thread frame gap
 *  (a proxy for UI responsiveness under load — smaller is smoother). */
async function spawn25(): Promise<{ count: number; totalMs: number; maxFrameGapMs: number }> {
  let maxGap = 0;
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const t0 = performance.now();
  const ids: number[] = [];
  for (let i = 0; i < 25; i++) {
    const ch = new Channel<string>();
    ch.onmessage = () => {};
    ids.push(await invoke<number>("pty_spawn", { cwd: null, rows: 24, cols: 80, shell: null, onOutput: ch }));
  }
  const totalMs = Math.round(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 1500)); // observe responsiveness under load
  running = false;
  for (const id of ids) await invoke("pty_close", { id });
  return { count: ids.length, totalMs, maxFrameGapMs: Math.round(maxGap) };
}

export async function runBenchmark(): Promise<Record<string, unknown>> {
  const latency = await inputLatency();
  const spawn = await spawn25();
  const result = { latency, spawn };
  await invoke("write_bench", { data: JSON.stringify(result, null, 2) });
  return result;
}
