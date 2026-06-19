// Mirrors the Rust `model.rs` structs (serialized camelCase).

export interface Repository {
  id: string;
  path: string;
  name: string;
  isGit: boolean;
}

export interface Worktree {
  id: string;
  repoId: string;
  path: string;
  name: string;
  branch: string | null;
  isPrimary: boolean;
}
