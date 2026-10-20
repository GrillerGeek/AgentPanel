// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";
import type { Repository } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const repo = (name: string): Repository => ({
  id: `C:\\src\\${name}`,
  path: `C:\\src\\${name}`,
  name,
  isGit: true,
  defaultBranch: null,
});

const names = () => useStore.getState().repositories.map((r) => r.name);

beforeEach(() => {
  useStore.setState({ repositories: [repo("beta"), repo("Alpha"), repo("gamma")], toasts: [] });
  vi.mocked(invoke).mockReset();
});

describe("moveRepository (sidebar drag)", () => {
  it("moves a repository to the target's position without saving", () => {
    const [beta, , gamma] = useStore.getState().repositories;
    useStore.getState().moveRepository(gamma.id, beta.id);
    expect(names()).toEqual(["gamma", "beta", "Alpha"]);
    expect(invoke).not.toHaveBeenCalled(); // saved once, on drop
  });

  it("ignores unknown ids", () => {
    useStore.getState().moveRepository("nope", useStore.getState().repositories[0].id);
    expect(names()).toEqual(["beta", "Alpha", "gamma"]);
  });
});

describe("saveRepositoryOrder", () => {
  it("sends the current order to the backend", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useStore.getState().saveRepositoryOrder();
    expect(invoke).toHaveBeenCalledWith("reorder_repositories", {
      ids: useStore.getState().repositories.map((r) => r.id),
    });
  });

  it("surfaces a failed save as a toast", async () => {
    vi.mocked(invoke).mockRejectedValue("disk full");
    await useStore.getState().saveRepositoryOrder();
    expect(useStore.getState().toasts.at(-1)?.message).toContain("disk full");
  });
});

describe("sortRepositoriesByName", () => {
  it("sorts A→Z ignoring case, then saves", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useStore.getState().sortRepositoriesByName();
    expect(names()).toEqual(["Alpha", "beta", "gamma"]);
    expect(invoke).toHaveBeenCalledWith("reorder_repositories", {
      ids: useStore.getState().repositories.map((r) => r.id),
    });
  });

  it("orders numbered names naturally", async () => {
    useStore.setState({ repositories: [repo("app10"), repo("app2")] });
    await useStore.getState().sortRepositoriesByName();
    expect(names()).toEqual(["app2", "app10"]);
  });
});
