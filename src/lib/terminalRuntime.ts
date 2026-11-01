import { Channel, invoke } from "@tauri-apps/api/core";
import type { HerdrRuntime } from "../types";

export interface TerminalConnection {
  id: number;
  created: boolean;
  write(data: string): Promise<void>;
  resize(rows: number, cols: number): Promise<void>;
  dispose(terminate: boolean): Promise<void>;
}

export async function startInitialCommand(connection: TerminalConnection, command?: string): Promise<void> {
  if (command && connection.created) await connection.write(command + "\r");
}

type RuntimeEvent = { kind: "output"; data: string; bytes: number }
  | { kind: "status"; state: string | null }
  | { kind: "closed"; code: number | null; reason: string }
  | { kind: "disconnected"; message: string };

export async function openTerminal(options: {
  runtime?: HerdrRuntime; cwd: string; rows: number; cols: number; shell: string;
  env: Record<string, string> | null;
  output(data: string, consumed: () => void): void;
  status(state: string | null): void;
  closed(code: number | null): void;
  disconnected(message: string): void;
  binding(binding: NonNullable<HerdrRuntime["binding"]>): void;
}): Promise<TerminalConnection> {
  let id: number | undefined;
  let created = true;
  const prefix = options.runtime ? "herdr" : "pty";
  if (options.runtime) {
    const pending: number[] = [];
    const acknowledge = (bytes: number) => {
      if (id === undefined) pending.push(bytes);
      else void invoke("herdr_ack", { id, bytes }).catch(() => {});
    };
    const onEvent = new Channel<RuntimeEvent>();
    onEvent.onmessage = (event) => {
      switch (event.kind) {
        case "output": options.output(event.data, () => acknowledge(event.bytes)); break;
        case "status": options.status(event.state); break;
        case "closed": options.closed(event.code); break;
        case "disconnected": options.disconnected(event.message); break;
      }
    };
    const result = await invoke<{ id: number; created: boolean; binding: NonNullable<HerdrRuntime["binding"]> }>("herdr_open", {
      options: { ...options.runtime, cwd: options.cwd, shell: options.shell, env: options.env ?? {}, binding: options.runtime.binding ?? null },
      rows: options.rows, cols: options.cols, onEvent,
    });
    id = result.id;
    created = result.created;
    options.binding(result.binding);
    for (const bytes of pending) acknowledge(bytes);
  } else {
    const onOutput = new Channel<string>();
    onOutput.onmessage = (data) => options.output(data, () => {});
    id = await invoke<number>("pty_spawn", { cwd: options.cwd, rows: options.rows, cols: options.cols,
      shell: options.shell || null, env: options.env, onOutput });
  }
  return {
    id, created,
    write: (data) => invoke(`${prefix}_write`, { id, data }),
    resize: (rows, cols) => invoke(`${prefix}_resize`, { id, rows, cols }),
    dispose: async (terminate) => {
      if (!options.runtime) { await invoke("pty_close", { id }); return; }
      if (terminate) await invoke("herdr_terminate", { id });
      await invoke("herdr_detach", { id });
    },
  };
}
