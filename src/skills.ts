import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { builtInSkillsDir, userSkillsRoot, workspaceSkillsRoot } from "./paths";
import { SkillManifestSchema, type DevteamConfig, type SkillManifest } from "./types";
import { pathExists, readStructuredFile } from "./util";

export type LoadedSkill = {
  id: string;
  dir: string;
  manifestPath: string;
  promptPath: string;
  manifest: SkillManifest;
  prompt: string;
  source: "explicit" | "workspace-config" | "workspace" | "user-config" | "user" | "builtin";
};

async function findManifestInDir(skillDir: string) {
  for (const candidate of ["skill.yaml", "skill.yml", "skill.json"]) {
    const path = join(skillDir, candidate);
    if (await pathExists(path)) return path;
  }

  return null;
}

async function loadSkillAt(pathOrDir: string, source: LoadedSkill["source"]): Promise<LoadedSkill> {
  const resolved = resolve(pathOrDir);
  const manifestPath =
    [".yaml", ".yml", ".json"].includes(extname(resolved).toLowerCase())
      ? resolved
      : await findManifestInDir(resolved);

  if (!manifestPath) {
    throw new Error(`No skill manifest found at ${resolved}`);
  }

  const manifestDir =
    [".yaml", ".yml", ".json"].includes(extname(resolved).toLowerCase()) ? dirname(resolved) : resolved;
  const raw = await readStructuredFile(manifestPath);
  const manifest = SkillManifestSchema.parse(raw);
  const promptFile = manifest.instructions?.prompt_file ?? "prompt.md";
  const promptPath = join(manifestDir, promptFile);

  if (!(await pathExists(promptPath))) {
    throw new Error(`Skill prompt file not found: ${promptPath}`);
  }

  const prompt = await readFile(promptPath, "utf8");

  return {
    id: manifest.id,
    dir: manifestDir,
    manifestPath,
    promptPath,
    manifest,
    prompt,
    source,
  };
}

export async function resolveSkill(
  workspace: string,
  config: DevteamConfig,
  skillId: string,
  explicitPath?: string,
) {
  if (explicitPath) {
    return loadSkillAt(explicitPath, "explicit");
  }

  const workspaceConfigPath = config.skills?.[skillId];
  if (workspaceConfigPath && (await pathExists(resolve(workspace, workspaceConfigPath)))) {
    return loadSkillAt(resolve(workspace, workspaceConfigPath), "workspace-config");
  }

  if (workspaceConfigPath && (await pathExists(resolve(workspaceConfigPath)))) {
    return loadSkillAt(resolve(workspaceConfigPath), "workspace-config");
  }

  const workspaceDir = join(workspaceSkillsRoot(workspace), skillId);
  if (await pathExists(workspaceDir)) {
    return loadSkillAt(workspaceDir, "workspace");
  }

  const userConfigPath = config.skills?.[skillId];
  if (userConfigPath && (await pathExists(resolve(userConfigPath)))) {
    return loadSkillAt(resolve(userConfigPath), "user-config");
  }

  const userDir = join(userSkillsRoot(), skillId);
  if (await pathExists(userDir)) {
    return loadSkillAt(userDir, "user");
  }

  const builtinDir = join(builtInSkillsDir, skillId);
  if (await pathExists(builtinDir)) {
    return loadSkillAt(builtinDir, "builtin");
  }

  throw new Error(`Skill not found: ${skillId}`);
}

async function collectSkillDirs(root: string, source: LoadedSkill["source"]) {
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const loaded: LoadedSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      loaded.push(await loadSkillAt(join(root, entry.name), source));
    } catch {
      continue;
    }
  }

  return loaded;
}

export async function listSkills(workspace: string, config: DevteamConfig) {
  const byId = new Map<string, LoadedSkill>();

  for (const skill of await collectSkillDirs(builtInSkillsDir, "builtin")) {
    byId.set(skill.id, skill);
  }

  for (const skill of await collectSkillDirs(userSkillsRoot(), "user")) {
    byId.set(skill.id, skill);
  }

  for (const skill of await collectSkillDirs(workspaceSkillsRoot(workspace), "workspace")) {
    byId.set(skill.id, skill);
  }

  for (const [id, mappedPath] of Object.entries(config.skills ?? {})) {
    try {
      const resolved = await loadSkillAt(
        mappedPath.startsWith(".") ? resolve(workspace, mappedPath) : mappedPath,
        "workspace-config",
      );
      byId.set(id, resolved);
    } catch {
      continue;
    }
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function skillSummary(skill: LoadedSkill) {
  return {
    id: skill.id,
    description: skill.manifest.description,
    source: skill.source,
    path: skill.dir,
  };
}
