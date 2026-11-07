// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MachineBrowser } from "./MachineBrowser";
import { useStore } from "../state/store";
import type { HerdrInventory } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const inventory: HerdrInventory = { coreId: "core", coreName: "mac", machines: [
  { name: "box", coreId: "remote", host: "linux", session: "work", state: "connected", why: null },
  { name: "offline", coreId: "sleeping", host: "laptop", session: null, state: "needs_login", why: "SSH authentication required" },
], terminals: [
  { address: "box/t1", cwd: "/same/path", title: "codex", state: "live", status: null },
  { address: "offline/t1", cwd: "/same/path", title: null, state: "live", status: "working" },
] };
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(inventory);
  useStore.setState({ terminals: [], activeTabId: null });
  useStore.getState().updateSettings({ herdrBrowserEndpoint: undefined });
});
afterEach(cleanup);

it("remembers a successfully browsed session without changing the runtime for new local terminals", async () => {
  const original = { ...useStore.getState().settings };
  const view = render(<MachineBrowser onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Herdr executable"), { target: { value: "/another/hc" } });
  fireEvent.change(screen.getByLabelText("Local core session"), { target: { value: "another-session" } });
  fireEvent.click(screen.getByText("Refresh terminals"));
  await screen.findByRole("button", { name: "Attach box/t1" });
  view.unmount();
  render(<MachineBrowser onClose={vi.fn()} />);
  expect((screen.getByLabelText("Herdr executable") as HTMLInputElement).value).toBe("/another/hc");
  expect((screen.getByLabelText("Local core session") as HTMLInputElement).value).toBe("another-session");
  const settings = useStore.getState().settings;
  expect(settings.terminalRuntime).toBe(original.terminalRuntime);
  expect(settings.herdrExecutable).toBe(original.herdrExecutable);
  expect(settings.herdrSession).toBe(original.herdrSession);
});

it("browses configured machines, shows unknown status, and disables offline terminal attachment", async () => {
  const close = vi.fn(); render(<MachineBrowser onClose={close} />);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Refresh terminals"));
  const attach = await screen.findByRole("button", { name: "Attach box/t1" });
  expect(screen.getByText("live · status not reported")).toBeTruthy();
  expect(screen.getByText("SSH authentication required")).toBeTruthy();
  expect(screen.getByText("Last observed live · current status unavailable")).toBeTruthy();
  expect(screen.queryByText("live · working")).toBeNull();
  expect(screen.getByRole("button", { name: "Attach offline/t1" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(attach);
  expect(useStore.getState().terminals[0].panes[0].runtime?.binding).toEqual({ coreId: "core", machineId: "remote", address: "box/t1" });
  expect(close).toHaveBeenCalledOnce();
});

it("keeps failed-refresh inventory visible but stale, and prevents attaching after endpoint edits", async () => {
  render(<MachineBrowser onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("Refresh terminals"));
  await screen.findByRole("button", { name: "Attach box/t1" });
  vi.mocked(invoke).mockRejectedValueOnce("core unavailable");
  fireEvent.click(screen.getByText("Refresh terminals"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Attach box/t1" }).hasAttribute("disabled")).toBe(true);
  vi.mocked(invoke).mockResolvedValue(inventory);
  fireEvent.click(screen.getByText("Refresh terminals"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  fireEvent.change(screen.getByLabelText("Local core session"), { target: { value: "another" } });
  expect(screen.getByRole("button", { name: "Attach box/t1" }).hasAttribute("disabled")).toBe(true);
});
