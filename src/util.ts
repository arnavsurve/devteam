import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname } from "node:path";
import YAML from "yaml";

export async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function readTextIfExists(path: string) {
  if (!(await pathExists(path))) return null;
  return readFile(path, "utf8");
}

export async function readStructuredFile(path: string) {
  const content = await readFile(path, "utf8");
  const extension = extname(path).toLowerCase();

  if (extension === ".json") {
    return JSON.parse(content) as unknown;
  }

  return YAML.parse(content) as unknown;
}

export async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(path: string, value: string) {
  await ensureDir(dirname(path));
  await writeFile(path, value, "utf8");
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJsonFileContent(content: string) {
  return JSON.parse(content) as unknown;
}
