import { parse } from "@std/yaml";
import { join } from "node:path";

export interface McpServer {
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  only?: string[];
}

export interface Environment {
  extends?: string[];
  mcps?: string[];
  skills?: string[];
}

export interface SofaConfig {
  version: number;
  agents: string[];
  mcps: Record<string, McpServer>;
  skills: Record<string, string>;
  environments: Record<string, Environment>;
}

export async function loadConfig(dir: string): Promise<SofaConfig> {
  const path = join(dir, "sofa.yaml");
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`${path} not found - run \`sofa init\` first`);
    }
    throw e;
  }
  const raw = (parse(text) ?? {}) as Partial<SofaConfig>;
  return {
    version: raw.version ?? 1,
    agents: raw.agents ?? [],
    mcps: raw.mcps ?? {},
    skills: raw.skills ?? {},
    environments: raw.environments ?? {},
  };
}

/** MCP names of `base` plus the given environments (following `extends`). */
export function resolveMcps(cfg: SofaConfig, envs: string[]): string[] {
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (env: string, stack: string[]) => {
    const def = cfg.environments[env];
    if (!def) throw new Error(`unknown environment "${env}"`);
    if (stack.includes(env)) {
      throw new Error(`environment cycle: ${[...stack, env].join(" -> ")}`);
    }
    if (seen.has(env)) return;
    seen.add(env);
    for (const parent of def.extends ?? []) visit(parent, [...stack, env]);
    for (const m of def.mcps ?? []) {
      if (!cfg.mcps[m]) {
        throw new Error(`environment "${env}" references unknown MCP "${m}"`);
      }
      names.add(m);
    }
  };
  if (cfg.environments.base) visit("base", []);
  for (const e of envs) visit(e, []);
  return [...names];
}

export interface State {
  active: string[];
  owned: Record<string, string[]>;
}

export async function loadState(dir: string): Promise<State> {
  try {
    const s = JSON.parse(await Deno.readTextFile(join(dir, ".state.json")));
    return { active: s.active ?? [], owned: s.owned ?? {} };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { active: [], owned: {} };
    throw e;
  }
}

export async function saveState(dir: string, state: State) {
  await Deno.writeTextFile(
    join(dir, ".state.json"),
    JSON.stringify(state, null, 2) + "\n",
  );
}
