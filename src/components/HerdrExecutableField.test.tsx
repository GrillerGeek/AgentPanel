// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HerdrExecutableField } from "./HerdrExecutableField";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
function Field({ initial = "hc", changed = () => {} }: { initial?: string; changed?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <HerdrExecutableField value={value} onChange={(next) => { changed(next); setValue(next); }} />;
}
beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue("/home/user/.local/bin/hc"); vi.mocked(open).mockReset(); vi.mocked(openUrl).mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

it.each(["hc", "herdr-core"])("discovers an untouched %s default without opening a session", async (initial) => {
  render(<Field initial={initial} />);
  await waitFor(() => expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("/home/user/.local/bin/hc"));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("herdr_detect_executable", { executable: initial });
  expect(screen.getByRole("status").textContent).toContain("Found:");
});

it.each(["/custom/path with spaces/core", "custom-core"])("leaves explicit custom input %s untouched until Find is requested", async (initial) => {
  render(<Field initial={initial} />); expect(invoke).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe(initial);
  fireEvent.click(screen.getByText("Find automatically"));
  await screen.findByText("Found: /home/user/.local/bin/hc");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("herdr_detect_executable", { executable: "hc" });
});

it("ignores late detection after manual edits, even when the user returns to the original name", async () => {
  let finish!: (value: string) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
  const changed = vi.fn(); render(<Field changed={changed} />);
  fireEvent.change(screen.getByLabelText("Herdr core executable"), { target: { value: "/manual/hc" } });
  fireEvent.change(screen.getByLabelText("Herdr core executable"), { target: { value: "hc" } });
  await act(async () => finish("/late/hc"));
  expect(changed.mock.calls).toEqual([["/manual/hc"], ["hc"]]);
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("hc");
});

it("ignores detection completion after unmount", async () => {
  let finish!: (value: string) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
  const changed = vi.fn(); const view = render(<Field changed={changed} />); view.unmount();
  await act(async () => finish("/late/hc")); expect(changed).not.toHaveBeenCalled();
});

it("keeps a missing executable value and shows an actionable discovery failure", async () => {
  vi.mocked(invoke).mockRejectedValue("Herdr executable was not found. Use Browse or install Herdr core.");
  render(<Field />); await screen.findByText(/was not found/);
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("hc");
  expect(screen.getByRole("button", { name: "Find automatically" }).hasAttribute("disabled")).toBe(false);
});

it("browses for one native file and keeps cancellation or a later manual edit authoritative", async () => {
  vi.mocked(open).mockResolvedValueOnce("/folder with spaces/hc");
  render(<Field initial="/saved/hc" />);
  fireEvent.click(screen.getByText("Browse…"));
  await screen.findByText("Selected file: /folder with spaces/hc");
  expect(open).toHaveBeenCalledExactlyOnceWith({ title: "Choose the Herdr core executable", directory: false, multiple: false });
  vi.mocked(open).mockResolvedValueOnce(null); fireEvent.click(screen.getByText("Browse…"));
  await waitFor(() => expect(screen.getByText("Browse…").hasAttribute("disabled")).toBe(false));
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("/folder with spaces/hc");
  let finish!: (value: string) => void;
  vi.mocked(open).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText("Browse…")); fireEvent.change(screen.getByLabelText("Herdr core executable"), { target: { value: "/new/manual" } });
  await act(async () => finish("/late/picker"));
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("/new/manual");
});

it("reports native picker and system-browser failures visibly", async () => {
  vi.mocked(open).mockRejectedValue("picker unavailable"); vi.mocked(openUrl).mockRejectedValue("browser unavailable");
  render(<Field initial="/saved/hc" />);
  fireEvent.click(screen.getByText("Browse…")); await screen.findByText(/picker unavailable/);
  fireEvent.click(screen.getByText("Install Herdr core ↗")); await screen.findByText(/browser unavailable/);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://herdr.dev/core/");
  expect(invoke).not.toHaveBeenCalled();
});
