// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { useStore } from "../state/store";
import type { ShellInfo } from "../types";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.4.0") }));
vi.mock("../lib/updater", () => ({ runUpdateCheck: vi.fn().mockResolvedValue(undefined) }));

const MAC_SHELLS: ShellInfo[] = [
  { label: "Bash", path: "/bin/bash" },
  { label: "Zsh", path: "/bin/zsh" },
];
const WIN_SHELLS: ShellInfo[] = [
  { label: "PowerShell 7", path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
  {
    label: "Windows PowerShell",
    path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  },
];

function mockShellList(list: ShellInfo[]) {
  vi.mocked(invoke).mockImplementation((cmd) =>
    cmd === "list_shells" ? Promise.resolve(list) : Promise.resolve([]),
  );
}

function setShellSetting(shell: string) {
  useStore.setState((s) => ({ settings: { ...s.settings, shell } }));
}

afterEach(cleanup);
beforeEach(() => mockShellList([]));

describe("default shell setting", () => {
  it("defaults to the system-default sentinel, not a Windows-only executable", () => {
    // Fresh install (empty localStorage): the shell must be the empty sentinel so
    // the backend's platform-aware default_shell() picks $SHELL on macOS/Linux
    // and PowerShell on Windows. A hardcoded "powershell.exe" breaks macOS.
    expect(useStore.getState().settings.shell).toBe("");
  });
});

describe("SettingsModal shell picker", () => {
  it("shows 'System default' selected when no shell is configured", async () => {
    setShellSetting("");
    mockShellList(MAC_SHELLS);
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Zsh" })).toBeTruthy());
    const sysDefault = screen.getByRole("option", {
      name: /system default/i,
    }) as HTMLOptionElement;
    expect(sysDefault.selected).toBe(true);
    // No stray "Custom…" input pre-filled with a bogus executable.
    expect(screen.queryByPlaceholderText(/full path/i)).toBeNull();
  });

  it("still resolves a saved Windows shell to its detected entry", async () => {
    // Existing Windows users keep their concrete saved value and see it matched.
    setShellSetting("powershell.exe");
    mockShellList(WIN_SHELLS);
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        (screen.getByRole("option", { name: "Windows PowerShell" }) as HTMLOptionElement)
          .selected,
      ).toBe(true),
    );
  });

  it("keeps the system-default sentinel on save instead of forcing powershell.exe", async () => {
    setShellSetting("");
    mockShellList(MAC_SHELLS);
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Zsh" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().settings.shell).toBe("");
  });

  it("saves a concrete shell picked from the list", async () => {
    setShellSetting("");
    mockShellList(MAC_SHELLS);
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Zsh" })).toBeTruthy());
    const select = (screen.getByRole("option", { name: "Zsh" }) as HTMLOptionElement)
      .closest("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "/bin/zsh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().settings.shell).toBe("/bin/zsh");
  });
});
