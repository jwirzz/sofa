import { Command } from "@commander-js/extra-typings";
import { bold, dim, green } from "@std/fmt/colors";
import { dirname, join } from "node:path";
import { adapters, home, pruneEmpty } from "../adapters/mod.ts";
import { loadConfig, loadState, resolveEnvs, saveState, type SofaConfig, type State, userCwd } from "../config.ts";
import { ask, choose, err, fail, interactive, ok, pick, warn } from "../ui.ts";
import { sofaHome } from "./init.ts";
import { envList, localSkillsDir, readConfig, setEnvList, skillAuthor, skillPath, skillsDir, writeConfig } from "./skill.ts";

// skills dir per agent id (same ids as adapters): [project dir relative to cwd, global dir]
const inHome = (p: string) => () => join(home(), p);
const AGENT_DIRS: Record<string, [string, () => string]> = {
  "claude-code": [".claude/skills", inHome(".claude/skills")],
  codex: [".agents/skills", inHome(".agents/skills")],
  cursor: [".agents/skills", inHome(".cursor/skills")],
  gemini: [".agents/skills", inHome(".gemini/skills")],
  opencode: [".agents/skills", () => join(Deno.env.get("XDG_CONFIG_HOME") ?? join(home(), ".config"), "opencode/skills")],
  pi: [".agents/skills", inHome(".agents/skills")],
  vscode: [".agents/skills", inHome(".copilot/skills")],
};

const config = () => loadConfig(sofaHome()).catch((e) => fail(e.message));
const exists = (p: string) => Deno.lstat(p).then(() => true, () => false);
const scopeKey = (global?: boolean) => global ? "global" : userCwd();
const scopeLabel = (global?: boolean) => global ? "globally" : `in ${dim(userCwd())}`;

function resolve(cfg: SofaConfig, envs: string[]) {
  try {
    return resolveEnvs(cfg, envs);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

function dirsFor(global: boolean, agents: string[], quiet = false) {
  const dirs = new Set<string>();
  for (const a of agents) {
    const d = AGENT_DIRS[a];
    if (d) dirs.add(global ? d[1]() : join(userCwd(), d[0]));
    else if (!quiet) warn(`${a}: no skills support in sofa yet, skipped`);
  }
  return dirs;
}

// keep only skills that are installed in ~/.sofa/skills
async function installedOnly(cfg: SofaConfig, names: string[]) {
  const out: string[] = [];
  for (const n of names) {
    if (await skillPath(n)) out.push(n);
    else {
      const e = cfg.skills[n];
      warn(`${bold(n)}: not installed${e?.source ? `, run: sofa skill add ${e.source} -s ${e.skill ?? n}` : ""}`);
    }
  }
  return out;
}

// make the agents' skill dirs hold exactly the `wanted` sofa links; anything sofa didn't create is left alone
async function linkSkills(global: boolean, agents: string[], wanted: string[]) {
  const srcs = [skillsDir(), localSkillsDir()];
  const linkDirs = dirsFor(global, agents);
  for (const dir of dirsFor(global, Object.keys(AGENT_DIRS), true)) {
    const keep = linkDirs.has(dir) ? wanted : [];
    let removed = false;
    for (const e of await Array.fromAsync(Deno.readDir(dir)).catch(() => [])) {
      const path = join(dir, e.name);
      if (e.isSymlink && !keep.includes(e.name) && srcs.includes(dirname(await Deno.readLink(path)))) {
        await Deno.remove(path);
        removed = true;
      }
    }
    if (removed) await pruneEmpty(dir);
  }
  for (const dir of linkDirs) {
    if (wanted.length) await Deno.mkdir(dir, { recursive: true });
    for (const name of wanted) {
      const path = join(dir, name);
      const target = (await skillPath(name))!;
      if ((await Deno.readLink(path).catch(() => null)) === target) continue;
      if (await exists(path)) warn(`${dim(path)} exists and is not managed by sofa, skipped`);
      else await Deno.symlink(target, path, { type: "junction" }); // junction: no admin rights needed on Windows, ignored elsewhere
    }
  }
}

// write the MCPs into every agent's global config; agents dropped from sofa.yaml get theirs removed
async function writeMcps(cfg: SofaConfig, names: string[], state: State) {
  for (const id of new Set([...cfg.agents, ...Object.keys(state.owned)])) {
    const adapter = adapters[id];
    if (!adapter) {
      warn(`${id}: no MCP adapter (supported: ${Object.keys(adapters).join(", ")})`);
      continue;
    }
    const mine = cfg.agents.includes(id) ? names.filter((n) => !cfg.mcps[n].only || cfg.mcps[n].only!.includes(id)) : [];
    try {
      const r = await adapter.apply(Object.fromEntries(mine.map((n) => [n, cfg.mcps[n]])), state.owned[id] ?? [], false);
      if (r.written.length) state.owned[id] = r.written;
      else delete state.owned[id];
      if (r.changed) console.log(dim(`  ~ ${adapter.label}: ${r.written.length} MCPs → ${adapter.path()}`));
      for (const s of r.skipped) warn(`${adapter.label}: "${s}" already exists unmanaged, left untouched`);
    } catch (e) {
      err(`${adapter.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

const use = new Command("use")
  .description("Activate environments: link their skills; with -g also write their MCPs")
  .argument("[names...]", "environments to activate (asks if omitted); base is on unless --no-base")
  .option("-g, --global", "user-level: global skill dirs and the agents' MCP configs")
  .option("--no-base", "leave the base environment off")
  .action(async (names, opts) => {
    const cfg = await config();
    const state = await loadState(sofaHome());
    const key = scopeKey(opts.global);
    const all = Object.keys(cfg.environments);
    if (!names.length && all.length && interactive()) {
      const prev = state.active[key];
      names = await pick(
        `Activate which environments ${scopeLabel(opts.global)}?`,
        all.map((value) => ({ value, checked: prev ? prev.includes(value) : value === "base" && opts.base })),
      );
    } else if (opts.base && "base" in cfg.environments) names = ["base", ...names];
    const active = [...new Set(names)];
    const { mcps, skills } = resolve(cfg, active);
    const wanted = await installedOnly(cfg, skills);
    if (!cfg.agents.length) warn("no agents in sofa.yaml, nothing to set up");
    await linkSkills(!!opts.global, cfg.agents, wanted);
    if (opts.global) await writeMcps(cfg, mcps, state);
    state.active[key] = active;
    await saveState(sofaHome(), state);

    ok(`${active.map((a) => bold(a)).join(", ") || "no environment"} active ${scopeLabel(opts.global)}`);
    console.log(dim(`  skills: ${wanted.join(", ") || "none"}`));
    if (opts.global) console.log(dim(`  mcps: ${mcps.join(", ") || "none"}`));
    else if (mcps.length) console.log(dim(`  mcps: ${mcps.join(", ")} (MCP configs are global, apply them with -g)`));
  });

const edit = new Command("edit")
  .description("Choose interactively which skills and MCPs belong to an environment")
  .argument("[name]", "environment, created if new (asks if omitted)")
  .option("-l, --local", "write to sofa.local.yaml, not synced with git")
  .action(async (name, opts) => {
    if (!interactive()) fail("sofa env edit needs a terminal, or edit sofa.yaml directly");
    const doc = await readConfig(opts.local);
    const merged = await config();
    const shared = opts.local ? await loadConfig(sofaHome(), false) : merged;
    const raw = { environments: opts.local ? merged.environments : doc.toJS()?.environments, skills: merged.skills, mcps: merged.mcps };
    const NEW = "\0new";
    let env = name ?? await choose("Which environment?", [
      ...Object.keys(raw.environments ?? {}).map((value) => ({ value })),
      { value: NEW, name: dim("+ new environment") },
    ]);
    if (env === NEW) env = await ask("Name", (v) => /^[\w-]+$/.test(v) || "letters, digits, - and _ only");

    const chosen = { skills: [] as string[], mcps: [] as string[] };
    const kinds = [["skills", "Skills", "sofa skill add"], ["mcps", "MCPs", "add them under mcps: in sofa.yaml"]] as const;
    for (const [key, label, howToAdd] of kinds) {
      // in local mode, whatever the shared environment already has is on anyway
      const inShared = shared.environments[env]?.[key] ?? [];
      const catalog = Object.keys(raw[key] ?? {}).filter((n) => !opts.local || !inShared.includes(n));
      const current = envList(doc, env, key);
      if (!catalog.length) {
        console.log(dim(`  no ${label} in sofa.yaml yet (${howToAdd})`));
        chosen[key] = current;
        continue;
      }
      chosen[key] = await pick(
        `${label} in ${bold(env)}`,
        catalog.map((value) => ({ value, checked: current.includes(value) })),
      );
    }
    for (const [key] of kinds) setEnvList(doc, env, key, chosen[key]);
    await writeConfig(doc, opts.local);
    ok(`${bold(env)}${opts.local ? dim(" (local)") : ""}  ${dim(`skills: ${chosen.skills.join(", ") || "-"} · mcps: ${chosen.mcps.join(", ") || "-"}`)}`);
    if (Object.values((await loadState(sofaHome())).active).some((envs) => envs.includes(env))) {
      console.log(dim(`  ${env} is active somewhere, run sofa env use again to apply`));
    }
  });

const off = new Command("off")
  .description("Remove sofa's skill links (and with -g its MCPs)")
  .option("-g, --global", "user-level: global skill dirs and the agents' MCP configs")
  .action(async (opts) => {
    const state = await loadState(sofaHome());
    await linkSkills(!!opts.global, [], []);
    if (opts.global) await writeMcps(await config(), [], state);
    delete state.active[scopeKey(opts.global)];
    await saveState(sofaHome(), state);
    ok(`sofa ${opts.global ? "skills and MCPs" : "skills"} removed ${scopeLabel(opts.global)}`);
  });

const list = new Command("list")
  .alias("ls")
  .description("List environments and where they are active")
  .action(async () => {
    const cfg = await config();
    const state = await loadState(sofaHome());
    const envs = Object.entries(cfg.environments);
    if (!envs.length) return console.log(dim("no environments in sofa.yaml"));
    const scopes = { project: state.active[userCwd()], global: state.active.global };
    const baseOff = Object.values(scopes).some((s) => s && !s.includes("base"));
    for (const [name, env] of envs) {
      let where = Object.entries(scopes).filter(([, s]) => s?.includes(name)).map(([k]) => k);
      if (name === "base" && !where.length && !baseOff) where = ["default on"];
      const mark = where.length ? `${green("●")} ${bold(name)} ${dim(`(${where.join(", ")})`)}` : `${dim("○")} ${bold(name)}`;
      const parts = [
        env?.extends?.length && `extends ${env.extends.join(", ")}`,
        `skills: ${env?.skills?.map((s) => `${s} (${skillAuthor(cfg.skills[s])})`).join(", ") || "-"}`,
        `mcps: ${env?.mcps?.join(", ") || "-"}`,
      ].filter(Boolean);
      console.log(`${mark}  ${dim(parts.join(" · "))}`);
    }
  });

export const env = new Command("env")
  .description("Manage environments: named sets of skills and MCPs from sofa.yaml")
  .addCommand(list)
  .addCommand(use)
  .addCommand(edit)
  .addCommand(off);
