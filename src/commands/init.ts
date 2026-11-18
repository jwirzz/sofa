import { Command } from "@commander-js/extra-typings";
import { Checkbox } from "@cliffy/prompt";
import { dirname, join } from "node:path";
import { adapters } from "../adapters/mod.ts";

const exampleYaml = (agents: string[]) =>
  `version: 1
agents: [${agents.join(", ")}]

# Catalog: define every MCP and skill exactly once
mcps:
  playwright:
    command: npx
    args: ["-y", "@playwright/mcp@latest"]

skills: {}

# Environments: named sets that only reference the catalog
environments:
  base: # always active
    mcps: []
    skills: []
  frontend:
    mcps: [playwright]
    skills: []
`;

const GITIGNORE = `.state.json
.cache/
sofa.local.yaml
bin/
`;

export function sofaHome(): string {
  const override = Deno.env.get("SOFA_HOME");
  if (override) return override;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("Cannot determine home directory");
  return join(home, ".sofa");
}

async function git(args: string[], cwd?: string) {
  let out;
  try {
    out = await new Deno.Command("git", {
      args,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("git was not found in PATH");
    }
    throw e;
  }
  if (!out.success) throw new Error(`git ${args[0]} failed`);
}

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    // bin/ holds the installed sofa binary, so it doesn't count
    for await (const e of Deno.readDir(path)) if (e.name !== "bin") return true;
    return false;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function initFresh(dir: string, agents: string[]) {
  await Deno.mkdir(join(dir, "skills"), { recursive: true });
  await Deno.writeTextFile(join(dir, "sofa.yaml"), exampleYaml(agents));
  await Deno.writeTextFile(join(dir, ".gitignore"), GITIGNORE);
  await Deno.writeTextFile(join(dir, "skills", ".gitkeep"), "");
  await git(["init", "--quiet"], dir);
}

async function chooseAgents(flag: string | undefined): Promise<string[]> {
  const all = Object.keys(adapters);
  if (flag) {
    const ids = flag.split(",").map((a) => a.trim()).filter(Boolean);
    const bad = ids.filter((a) => !all.includes(a));
    if (bad.length) {
      throw new Error(
        `unknown agent(s): ${bad.join(", ")} (known: ${all.join(", ")})`,
      );
    }
    return ids;
  }
  if (!Deno.stdin.isTerminal()) return [];
  return await Checkbox.prompt({
    message: "Which agents do you use?",
    hint: "space: toggle, a: all, enter: confirm (none selected by default)",
    options: Object.values(adapters).map((a) => ({
      name: a.label,
      value: a.id,
      checked: false,
    })),
  });
}

export const init = new Command("init")
  .description("Create ~/.sofa (git repo with example sofa.yaml)")
  .option("--from <url>", "clone an existing sofa repo instead of creating one")
  .option("--agents <list>", "comma-separated agents (skips the menu)")
  .action(async (opts) => {
    const dir = sofaHome();
    try {
      if (await isNonEmptyDir(dir)) {
        throw new Error(`${dir} already exists and is not empty`);
      }
      if (opts.from) {
        await Deno.mkdir(dirname(dir), { recursive: true });
        // git refuses to clone into a non-empty dir (bin/ may exist), so clone aside and move in
        const tmp = await Deno.makeTempDir({ dir: dirname(dir) });
        try {
          await git(["clone", opts.from, tmp]);
          await Deno.mkdir(dir, { recursive: true });
          for await (const e of Deno.readDir(tmp)) {
            await Deno.rename(join(tmp, e.name), join(dir, e.name));
          }
          await Deno.writeTextFile(
            join(dir, ".git", "info", "exclude"),
            "bin/\n",
            { append: true },
          );
        } finally {
          await Deno.remove(tmp, { recursive: true }).catch(() => {});
        }
        console.log(`Cloned ${opts.from} into ${dir}`);
      } else {
        const agents = await chooseAgents(opts.agents);
        await initFresh(dir, agents);
        console.log(`Initialized sofa in ${dir}`);
        console.log(`Edit ${join(dir, "sofa.yaml")} to get started.`);
      }
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      Deno.exit(1);
    }
  });
