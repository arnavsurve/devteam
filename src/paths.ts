import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(srcDir, "..");
export const builtInSkillsDir = join(projectRoot, "skills");

export function workspaceConfigCandidates(workspace: string) {
  return [
    join(workspace, ".devteam", "config.yaml"),
    join(workspace, ".devteam", "config.yml"),
    join(workspace, ".devteam", "config.json"),
  ];
}

export function userConfigCandidates() {
  const root = join(os.homedir(), ".config", "devteam");
  return [join(root, "config.yaml"), join(root, "config.yml"), join(root, "config.json")];
}

export function workspaceSkillsRoot(workspace: string) {
  return join(workspace, ".devteam", "skills");
}

export function userSkillsRoot() {
  return join(os.homedir(), ".config", "devteam", "skills");
}

export function workspaceRunRoot(workspace: string) {
  return join(workspace, ".devteam", "runs");
}
