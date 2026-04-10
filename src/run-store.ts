import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceRunRoot } from "./paths";
import { PreparedRunSchema, RunStatusSchema, type PreparedRun, type RunState, type RunStatus } from "./types";
import { ensureDir, pathExists, sleep, writeJson } from "./util";

export type RunPaths = {
  root: string;
  spec: string;
  request: string;
  prompt: string;
  result: string;
  status: string;
  artifactsDir: string;
  stdout: string;
  stderr: string;
};

export function createRunId() {
  return `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function getRunPaths(workspace: string, runId: string): RunPaths {
  const root = join(workspaceRunRoot(workspace), runId);
  return {
    root,
    spec: join(root, "run-spec.json"),
    request: join(root, "task-request.json"),
    prompt: join(root, "task-prompt.md"),
    result: join(root, "task-result.json"),
    status: join(root, "status.json"),
    artifactsDir: join(root, "artifacts"),
    stdout: join(root, "stdout.log"),
    stderr: join(root, "stderr.log"),
  };
}

export async function initializeRun(spec: PreparedRun) {
  const paths = getRunPaths(spec.workspace, spec.run_id);
  await ensureDir(paths.root);
  await mkdir(paths.artifactsDir, { recursive: true });
  await writeJson(paths.spec, spec);
  await writeJson(paths.request, spec.request);

  const status: RunStatus = {
    run_id: spec.run_id,
    workspace: spec.workspace,
    task_type: spec.request.task_type,
    skill_id: spec.skill_id,
    state: "queued",
    adapter_kind: spec.adapter.kind,
    created_at: spec.created_at,
    updated_at: spec.created_at,
    result_path: paths.result,
    prompt_path: paths.prompt,
    stdout_path: paths.stdout,
    stderr_path: paths.stderr,
  };
  await writeJson(paths.status, status);
  return paths;
}

export async function loadPreparedRun(workspace: string, runId: string) {
  const paths = getRunPaths(workspace, runId);
  const raw = JSON.parse(await readFile(paths.spec, "utf8")) as unknown;
  return PreparedRunSchema.parse(raw);
}

export async function readStatus(workspace: string, runId: string) {
  const paths = getRunPaths(workspace, runId);
  const raw = JSON.parse(await readFile(paths.status, "utf8")) as unknown;
  return RunStatusSchema.parse(raw);
}

export async function updateStatus(workspace: string, runId: string, patch: Partial<RunStatus>) {
  const current = await readStatus(workspace, runId);
  const next: RunStatus = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await writeJson(getRunPaths(workspace, runId).status, next);
  return next;
}

export async function saveResult(workspace: string, runId: string, result: unknown) {
  await writeJson(getRunPaths(workspace, runId).result, result);
}

export async function readResultIfExists(workspace: string, runId: string) {
  const resultPath = getRunPaths(workspace, runId).result;
  if (!(await pathExists(resultPath))) return null;
  return JSON.parse(await readFile(resultPath, "utf8")) as unknown;
}

export async function waitForTerminalState(workspace: string, runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await readStatus(workspace, runId);
    if (isTerminalState(status.state)) return status;
    if (Date.now() >= deadline) return status;
    await sleep(500);
  }
}

export function isTerminalState(state: RunState) {
  return ["passed", "failed", "blocked", "error", "canceled"].includes(state);
}
