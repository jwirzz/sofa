import { parse } from "yaml";
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

/** `{ source, skill }` = installed via `npx skills add <source> --skill <skill>`, `{ path }` = custom skill in the sofa repo */
export interface SkillEntry {
  source?: string;
  skill?: string;
  path?: string;
}

export interface SofaConfig {
  version: number;
  agents: string[];
  mcps: Record<string, McpServer>;
  skills: Record<string, SkillEntry>;
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

/** MCP and skill names of the given environments (following `extends`). */
export function resolveEnvs(cfg: SofaConfig, envs: string[]) {
  const names = { mcps: new Set<string>(), skills: new Set<string>() };
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
    for (const kind of ["mcps", "skills"] as const) {
      for (const m of def[kind] ?? []) {
        if (!cfg[kind][m]) {
          const what = kind === "mcps" ? "MCP" : "skill";
          throw new Error(`environment "${env}" references unknown ${what} "${m}"`);
        }
        names[kind].add(m);
      }
    }
  };
  for (const e of envs) visit(e, []);
  return { mcps: [...names.mcps], skills: [...names.skills] };
}

/** The directory sofa was started from (`deno task` runs in the repo dir and passes the original one as INIT_CWD). */
export const userCwd = () => Deno.env.get("INIT_CWD") ?? Deno.cwd();

export interface State {
  active: Record<string, string[]>; // "global" or project path -> active environments (base included when on)
  owned: Record<string, string[]>; // agent id -> MCP names sofa wrote into its global config
}

export async function loadState(dir: string): Promise<State> {
  try {
    const s = JSON.parse(await Deno.readTextFile(join(dir, ".state.json")));
    // older state files (from `sofa sync`) stored the global environments as a plain list
    const active = Array.isArray(s.active) ? { global: ["base", ...s.active] } : s.active ?? {};
    return { active, owned: s.owned ?? {} };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { active: {}, owned: {} };
    throw e;
  }
}

export async function saveState(dir: string, state: State) {
  await Deno.writeTextFile(
    join(dir, ".state.json"),
    JSON.stringify(state, null, 2) + "\n",
  );
}
