import { spawnSync } from "node:child_process";

function runGit(workspace: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
  });
}

export function detectGitContext(workspace: string) {
  const inside = runGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return {
      current_ref: null,
      changed_files: [] as string[],
    };
  }

  const currentRef = runGit(workspace, ["rev-parse", "--short", "HEAD"]).stdout.trim() || null;
  const changed = new Set<string>();

  for (const args of [
    ["diff", "--name-only", "--cached"],
    ["diff", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const result = runGit(workspace, args);
    if (result.status !== 0) continue;
    for (const line of result.stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
      changed.add(line);
    }
  }

  return {
    current_ref: currentRef,
    changed_files: [...changed].sort(),
  };
}
