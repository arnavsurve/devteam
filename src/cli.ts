#!/usr/bin/env bun
import { loadMergedConfig, listKnownAdapters } from "./config";
import { executeRun, loadJsonContext, prepareRun, readAcceptanceFile, runLoop, spawnRun, writeOutputIfRequested } from "./broker";
import { readResultIfExists, readStatus, waitForTerminalState } from "./run-store";
import { listSkills, skillSummary } from "./skills";

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string[]>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const key = current;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, [...(flags.get(key) ?? []), "true"]);
      continue;
    }

    flags.set(key, [...(flags.get(key) ?? []), next]);
    index += 1;
  }

  return { positionals, flags };
}

function flagValue(args: ParsedArgs, key: string) {
  return args.flags.get(key)?.at(-1);
}

function flagValues(args: ParsedArgs, key: string) {
  return args.flags.get(key) ?? [];
}

function hasFlag(args: ParsedArgs, key: string) {
  return args.flags.has(key);
}

function usage() {
  console.log(`devteam

Usage:
  devteam delegate <skill> [options]
  devteam status <run-id> [options]
  devteam wait <run-id> [options]
  devteam list-skills [options]
  devteam list-adapters [options]
  devteam loop [options]

Core options:
  --workspace <path>         Workspace root (default: current directory)
  --adapter <name>           Named adapter from config
  --command <shell>          Inline shell wrapper command
  --skill-path <path>        Explicit skill directory or manifest path
  --goal <text>              Goal for the delegated task
  --acceptance-file <path>   Newline-separated acceptance criteria
  --context-file <path>      JSON context object
  --wait                     Wait for delegated runs to finish
  --json                     Print machine-readable output

Examples:
  devteam list-skills
  devteam delegate qa --goal "verify login flow" --adapter mock-pass --wait
  devteam delegate qa --goal "verify login flow" --command "./scripts/qa-wrapper.sh" --wait
  devteam loop --goal "implement feature X" --impl-adapter mock-pass --verify-adapter mock-pass
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const parsed = parseArgs(argv.slice(1));
  const workspace = flagValue(parsed, "--workspace") ?? process.cwd();
  const { config } = await loadMergedConfig(workspace);
  const json = hasFlag(parsed, "--json");

  switch (command) {
    case "delegate":
      return handleDelegate(parsed, workspace, config, json);
    case "status":
      return handleStatus(parsed, workspace, json);
    case "wait":
      return handleWait(parsed, workspace, json);
    case "list-skills":
      return handleListSkills(workspace, config, json);
    case "list-adapters":
      return handleListAdapters(config, json);
    case "loop":
      return handleLoop(parsed, workspace, config, json);
    case "__internal_run":
      return handleInternalRun(parsed, workspace);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

async function handleDelegate(
  parsed: ParsedArgs,
  workspace: string,
  config: Awaited<ReturnType<typeof loadMergedConfig>>["config"],
  json: boolean,
) {
  const skillId = parsed.positionals[0];
  if (!skillId) {
    throw new Error("delegate requires a skill id");
  }

  const goal = flagValue(parsed, "--goal");
  if (!goal) {
    throw new Error("delegate requires --goal");
  }

  const acceptanceCriteria = [
    ...flagValues(parsed, "--acceptance"),
    ...(await readAcceptanceFile(flagValue(parsed, "--acceptance-file"))),
  ];
  const context = await loadJsonContext(flagValue(parsed, "--context-file"));
  const prepared = await prepareRun(
    {
      workspace,
      skillId,
      skillPath: flagValue(parsed, "--skill-path"),
      adapterName: flagValue(parsed, "--adapter"),
      inlineShell: flagValue(parsed, "--command"),
      goal,
      ref: flagValue(parsed, "--ref"),
      acceptanceCriteria,
      context,
      wait: hasFlag(parsed, "--wait"),
      outputPath: flagValue(parsed, "--output"),
    },
    config,
  );

  if (hasFlag(parsed, "--wait")) {
    const result = await executeRun(workspace, prepared.runId);
    const payload = {
      run_id: prepared.runId,
      result,
    };
    await writeOutputIfRequested(flagValue(parsed, "--output"), payload);
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${prepared.runId}: ${result.status}`);
      console.log(result.summary);
    }
    return;
  }

  const pid = await spawnRun(workspace, prepared.runId);
  const payload = {
    run_id: prepared.runId,
    pid,
    status: "queued",
  };
  await writeOutputIfRequested(flagValue(parsed, "--output"), payload);

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Queued ${prepared.runId} (pid ${pid})`);
  }
}

async function handleStatus(parsed: ParsedArgs, workspace: string, json: boolean) {
  const runId = parsed.positionals[0];
  if (!runId) throw new Error("status requires a run id");
  const status = await readStatus(workspace, runId);
  const result = await readResultIfExists(workspace, runId);
  const payload = {
    status,
    result,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`${status.run_id}: ${status.state}`);
    if (result && typeof result === "object" && "summary" in result && typeof result.summary === "string") {
      console.log(result.summary);
    }
  }
}

async function handleWait(parsed: ParsedArgs, workspace: string, json: boolean) {
  const runId = parsed.positionals[0];
  if (!runId) throw new Error("wait requires a run id");
  const timeoutSec = Number(flagValue(parsed, "--timeout") ?? "900");
  const status = await waitForTerminalState(workspace, runId, timeoutSec * 1000);
  const result = await readResultIfExists(workspace, runId);
  const payload = {
    status,
    result,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`${status.run_id}: ${status.state}`);
    if (result && typeof result === "object" && "summary" in result && typeof result.summary === "string") {
      console.log(result.summary);
    }
  }
}

async function handleListSkills(
  workspace: string,
  config: Awaited<ReturnType<typeof loadMergedConfig>>["config"],
  json: boolean,
) {
  const skills = (await listSkills(workspace, config)).map(skillSummary);
  if (json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  for (const skill of skills) {
    console.log(`${skill.id}\t${skill.source}\t${skill.path}`);
    console.log(`  ${skill.description}`);
  }
}

async function handleListAdapters(
  config: Awaited<ReturnType<typeof loadMergedConfig>>["config"],
  json: boolean,
) {
  const adapters = listKnownAdapters(config);
  if (json) {
    console.log(JSON.stringify(adapters, null, 2));
    return;
  }

  for (const adapter of adapters) {
    console.log(`${adapter.name}\t${adapter.kind}\t${adapter.source}`);
  }
}

async function handleLoop(
  parsed: ParsedArgs,
  workspace: string,
  config: Awaited<ReturnType<typeof loadMergedConfig>>["config"],
  json: boolean,
) {
  const goal = flagValue(parsed, "--goal");
  if (!goal) throw new Error("loop requires --goal");
  const acceptanceCriteria = [
    ...flagValues(parsed, "--acceptance"),
    ...(await readAcceptanceFile(flagValue(parsed, "--acceptance-file"))),
  ];
  const context = await loadJsonContext(flagValue(parsed, "--context-file"));
  const maxIterations = Number(flagValue(parsed, "--max-iterations") ?? config.defaults?.max_iterations ?? 3);
  const result = await runLoop({
    workspace,
    goal,
    acceptanceCriteria,
    context,
    implSkillId: flagValue(parsed, "--impl-skill") ?? config.defaults?.implement_skill ?? "implement",
    verifySkillId: flagValue(parsed, "--verify-skill") ?? config.defaults?.verify_skill ?? "qa",
    implAdapterName: flagValue(parsed, "--impl-adapter") ?? flagValue(parsed, "--adapter"),
    verifyAdapterName: flagValue(parsed, "--verify-adapter"),
    implInlineShell: flagValue(parsed, "--impl-command"),
    verifyInlineShell: flagValue(parsed, "--verify-command"),
    maxIterations,
    config,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.status}: ${result.summary}`);
  }
}

async function handleInternalRun(parsed: ParsedArgs, workspace: string) {
  const runId = parsed.positionals[0];
  if (!runId) throw new Error("__internal_run requires a run id");
  const result = await executeRun(workspace, runId);
  console.log(JSON.stringify({ run_id: runId, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
