import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveAdapterFromConfig } from "./config";
import { executeAdapter } from "./adapters";
import { detectGitContext } from "./git";
import { createRunId, getRunPaths, initializeRun, loadPreparedRun, readResultIfExists, updateStatus } from "./run-store";
import { resolveSkill } from "./skills";
import { PreparedRunSchema, TaskResultSchema, type DevteamConfig, type PreparedRun, type TaskRequest } from "./types";
import { ensureDir, parseJsonFileContent, writeJson, writeText } from "./util";

export type DelegateOptions = {
  workspace: string;
  skillId: string;
  skillPath?: string;
  adapterName?: string;
  inlineShell?: string;
  goal: string;
  ref?: string;
  acceptanceCriteria: string[];
  context: Record<string, unknown>;
  wait: boolean;
  outputPath?: string;
};

export async function prepareRun(options: DelegateOptions, config: DevteamConfig) {
  const resolvedSkill = await resolveSkill(options.workspace, config, options.skillId, options.skillPath);
  const resolvedAdapter = resolveAdapterFromConfig(config, options.adapterName, options.inlineShell);

  if (!resolvedAdapter) {
    throw new Error("No adapter resolved. Pass --adapter, --command, or configure defaults.adapter.");
  }

  const runId = createRunId();
  const paths = getRunPaths(options.workspace, runId);
  await ensureDir(paths.artifactsDir);

  const gitContext = detectGitContext(options.workspace);
  const request: TaskRequest = {
    task_type: options.skillId,
    run_id: runId,
    workspace: options.workspace,
    ref: options.ref ?? gitContext.current_ref ?? "HEAD",
    goal: options.goal,
    acceptance_criteria: options.acceptanceCriteria,
    context: {
      git: gitContext,
      ...options.context,
    },
    artifacts_dir: paths.artifactsDir,
    reply_format: "structured_v1",
  };

  const prompt = assemblePrompt({
    request,
    skillPrompt: resolvedSkill.prompt,
    skillId: resolvedSkill.id,
    allowCodeChanges: resolvedSkill.manifest.policy?.allow_code_changes ?? false,
  });

  const spec: PreparedRun = PreparedRunSchema.parse({
    run_id: runId,
    workspace: options.workspace,
    skill_id: resolvedSkill.id,
    skill_source: resolvedSkill.dir,
    request,
    adapter: resolvedAdapter.adapter,
    created_at: new Date().toISOString(),
  });

  await initializeRun(spec);
  await writeText(paths.prompt, prompt);

  return {
    runId,
    spec,
    prompt,
  };
}

export async function executeRun(workspace: string, runId: string) {
  const spec = await loadPreparedRun(workspace, runId);
  const paths = getRunPaths(workspace, runId);
  await updateStatus(workspace, runId, { state: "running" });

  try {
    const result = TaskResultSchema.parse(await executeAdapter(spec));
    await writeJson(paths.result, result);
    await updateStatus(workspace, runId, { state: result.status });
    return result;
  } catch (error) {
    const result = {
      status: "error" as const,
      summary: error instanceof Error ? error.message : "Unknown broker error.",
      findings: [],
      artifacts: [],
      proof: [],
      next_action: "Inspect the run logs and adapter configuration.",
      metadata: {},
    };
    await writeJson(paths.result, result);
    await updateStatus(workspace, runId, {
      state: "error",
      error: error instanceof Error ? error.message : "Unknown broker error.",
    });
    return result;
  }
}

export async function spawnRun(workspace: string, runId: string) {
  const args = [process.argv[1], "__internal_run", runId, "--workspace", workspace];
  const child = spawn(process.execPath, args, {
    cwd: workspace,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await updateStatus(workspace, runId, { pid: child.pid });
  return child.pid;
}

export async function writeOutputIfRequested(outputPath: string | undefined, result: unknown) {
  if (!outputPath) return;
  await writeJson(outputPath, result);
}

export async function loadJsonContext(path: string | undefined) {
  if (!path) return {};
  return parseJsonFileContent(await readFile(path, "utf8")) as Record<string, unknown>;
}

export async function readAcceptanceFile(path: string | undefined) {
  if (!path) return [];
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, ""));
}

export async function runLoop(options: {
  workspace: string;
  goal: string;
  acceptanceCriteria: string[];
  context: Record<string, unknown>;
  implSkillId: string;
  verifySkillId: string;
  implAdapterName?: string;
  verifyAdapterName?: string;
  implInlineShell?: string;
  verifyInlineShell?: string;
  maxIterations: number;
  config: DevteamConfig;
}) {
  const iterations: Array<Record<string, unknown>> = [];
  let feedback: Record<string, unknown> = {};

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    const implRun = await prepareRun(
      {
        workspace: options.workspace,
        skillId: options.implSkillId,
        adapterName: options.implAdapterName,
        inlineShell: options.implInlineShell,
        goal: options.goal,
        acceptanceCriteria: options.acceptanceCriteria,
        context: {
          ...options.context,
          loop_iteration: iteration,
          feedback,
        },
        wait: true,
      },
      options.config,
    );
    const implResult = await executeRun(options.workspace, implRun.runId);
    iterations.push({
      iteration,
      phase: "implement",
      run_id: implRun.runId,
      result: implResult,
    });
    if (implResult.status !== "passed") {
      return {
        status: implResult.status,
        summary: "Implementation phase did not complete successfully.",
        iterations,
      };
    }

    const verifyRun = await prepareRun(
      {
        workspace: options.workspace,
        skillId: options.verifySkillId,
        adapterName: options.verifyAdapterName ?? options.implAdapterName,
        inlineShell: options.verifyInlineShell,
        goal: options.goal,
        acceptanceCriteria: options.acceptanceCriteria,
        context: {
          ...options.context,
          loop_iteration: iteration,
          implementation_run_id: implRun.runId,
          implementation_summary: implResult.summary,
          implementation_metadata: implResult.metadata,
          feedback,
        },
        wait: true,
      },
      options.config,
    );
    const verifyResult = await executeRun(options.workspace, verifyRun.runId);
    iterations.push({
      iteration,
      phase: "verify",
      run_id: verifyRun.runId,
      result: verifyResult,
    });

    if (verifyResult.status === "passed") {
      return {
        status: "passed",
        summary: `Verification passed on iteration ${iteration}.`,
        iterations,
      };
    }

    if (verifyResult.status === "blocked" || verifyResult.status === "error") {
      return {
        status: verifyResult.status,
        summary: "Verification could not continue.",
        iterations,
      };
    }

    feedback = {
      verification_summary: verifyResult.summary,
      verification_findings: verifyResult.findings,
      verification_next_action: verifyResult.next_action,
    };
  }

  return {
    status: "failed",
    summary: `Verification did not pass within ${options.maxIterations} iterations.`,
    iterations,
  };
}

function assemblePrompt(input: {
  request: TaskRequest;
  skillPrompt: string;
  skillId: string;
  allowCodeChanges: boolean;
}) {
  return [
    `You are executing delegated task \`${input.skillId}\`.`,
    "",
    "Goal:",
    input.request.goal,
    "",
    "Constraints:",
    `- Work only inside ${input.request.workspace}`,
    `- Ref under test: ${input.request.ref}`,
    `- Save artifacts in ${input.request.artifacts_dir}`,
    `- ${input.allowCodeChanges ? "Code changes are allowed if needed." : "Do not modify code unless the calling task explicitly instructs you to."}`,
    "",
    "Acceptance criteria:",
    input.request.acceptance_criteria.length > 0
      ? input.request.acceptance_criteria.map((line) => `- ${line}`).join("\n")
      : "- None provided",
    "",
    "Context:",
    "```json",
    JSON.stringify(input.request.context, null, 2),
    "```",
    "",
    "Skill instructions:",
    input.skillPrompt.trim(),
    "",
    "Return exactly one JSON object with this shape:",
    "```json",
    JSON.stringify(
      {
        status: "passed | failed | blocked | error",
        summary: "short summary",
        findings: [],
        artifacts: [],
        proof: [],
        next_action: null,
        metadata: {},
      },
      null,
      2,
    ),
    "```",
    "",
  ].join("\n");
}
