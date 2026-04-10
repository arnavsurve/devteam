import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import { builtInSkillsDir, userSkillsRoot, workspaceSkillsRoot } from "./paths";
import { SkillManifestSchema, type DevteamConfig, type SkillManifest } from "./types";
import { pathExists, readStructuredFile } from "./util";
import YAML from "yaml";

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
  for (const candidate of ["SKILL.md", "skill.md"]) {
    const path = join(skillDir, candidate);
    if (await pathExists(path)) return path;
  }

  for (const candidate of ["skill.yaml", "skill.yml", "skill.json"]) {
    const path = join(skillDir, candidate);
    if (await pathExists(path)) return path;
  }

  return null;
}

function parseMarkdownSkill(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Markdown skills must start with YAML frontmatter.");
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error("Markdown skills require a closing frontmatter delimiter.");
  }

  const frontmatter = normalized.slice(4, end);
  const body = normalized.slice(end + 5).replace(/^\n+/, "");
  const raw = YAML.parse(frontmatter) as unknown;
  const parsed = SkillManifestSchema.parse(raw);
  return {
    manifest: normalizeManifest(parsed),
    prompt: body,
  };
}

function normalizeManifest(manifest: z.infer<typeof SkillManifestSchema>): SkillManifest {
  return {
    ...manifest,
    id: manifest.id ?? manifest.name!,
  };
}

async function loadSkillAt(pathOrDir: string, source: LoadedSkill["source"]): Promise<LoadedSkill> {
  const resolved = resolve(pathOrDir);
  const extension = extname(resolved).toLowerCase();
  const manifestPath =
    [".yaml", ".yml", ".json", ".md"].includes(extension) ? resolved : await findManifestInDir(resolved);

  if (!manifestPath) {
    throw new Error(`No skill manifest found at ${resolved}`);
  }

  const manifestDir = [".yaml", ".yml", ".json", ".md"].includes(extension) ? dirname(manifestPath) : resolved;
  let manifest: SkillManifest;
  let promptPath: string;
  let prompt: string;

  if (extname(manifestPath).toLowerCase() === ".md") {
    const parsed = parseMarkdownSkill(await readFile(manifestPath, "utf8"));
    manifest = parsed.manifest;
    promptPath = manifestPath;
    prompt = parsed.prompt;
  } else {
    const raw = await readStructuredFile(manifestPath);
    manifest = normalizeManifest(SkillManifestSchema.parse(raw));
    const promptFile = manifest.instructions?.prompt_file ?? "prompt.md";
    promptPath = join(manifestDir, promptFile);

    if (!(await pathExists(promptPath))) {
      throw new Error(`Skill prompt file not found: ${promptPath}`);
    }

    prompt = await readFile(promptPath, "utf8");
  }

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
    manifest_path: skill.manifestPath,
  };
}
