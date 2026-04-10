import { DevteamConfigSchema, type AdapterConfig, type DevteamConfig } from "./types";
import { userConfigCandidates, workspaceConfigCandidates } from "./paths";
import { pathExists, readStructuredFile } from "./util";

const builtInAdapters: Record<string, AdapterConfig> = {
  "mock-pass": { kind: "mock", status: "passed", summary: "Mock adapter passed." },
  "mock-fail": { kind: "mock", status: "failed", summary: "Mock adapter failed." },
  "mock-blocked": { kind: "mock", status: "blocked", summary: "Mock adapter blocked." },
};

function mergeConfig(base: DevteamConfig, override: DevteamConfig): DevteamConfig {
  return {
    ...base,
    ...override,
    skills: {
      ...(base.skills ?? {}),
      ...(override.skills ?? {}),
    },
    adapters: {
      ...(base.adapters ?? {}),
      ...(override.adapters ?? {}),
    },
    defaults: {
      ...(base.defaults ?? {}),
      ...(override.defaults ?? {}),
    },
  };
}

async function loadFirstConfig(paths: string[]) {
  for (const path of paths) {
    if (!(await pathExists(path))) continue;
    const raw = await readStructuredFile(path);
    return {
      path,
      config: DevteamConfigSchema.parse(raw),
    };
  }

  return null;
}

export async function loadMergedConfig(workspace: string) {
  const user = await loadFirstConfig(userConfigCandidates());
  const local = await loadFirstConfig(workspaceConfigCandidates(workspace));
  const merged = mergeConfig(user?.config ?? {}, local?.config ?? {});

  return {
    config: merged,
    sources: {
      user: user?.path ?? null,
      workspace: local?.path ?? null,
    },
  };
}

export function resolveAdapterFromConfig(
  config: DevteamConfig,
  adapterName: string | undefined,
  inlineShell: string | undefined,
) {
  if (inlineShell) {
    return {
      name: "inline-shell",
      adapter: {
        kind: "shell",
        shell: inlineShell,
      } satisfies AdapterConfig,
      source: "inline",
    };
  }

  if (!adapterName) {
    if (!config.defaults?.adapter) return null;
    return resolveAdapterFromConfig(config, config.defaults.adapter, undefined);
  }

  if (builtInAdapters[adapterName]) {
    return {
      name: adapterName,
      adapter: builtInAdapters[adapterName],
      source: "builtin",
    };
  }

  if (config.adapters?.[adapterName]) {
    return {
      name: adapterName,
      adapter: config.adapters[adapterName],
      source: "config",
    };
  }

  return null;
}

export function listKnownAdapters(config: DevteamConfig) {
  const configured = Object.entries(config.adapters ?? {}).map(([name, adapter]) => ({
    name,
    kind: adapter.kind,
    source: "config",
  }));
  const builtin = Object.entries(builtInAdapters).map(([name, adapter]) => ({
    name,
    kind: adapter.kind,
    source: "builtin",
  }));

  return [...builtin, ...configured];
}
