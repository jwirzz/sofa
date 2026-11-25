import { Command } from "@commander-js/extra-typings";
import { bold, dim } from "@std/fmt/colors";
import { cp } from "node:fs/promises";
import { basename, join } from "node:path";
import { home } from "../lib/adapters/mod.ts";
import { loadConfig, sofaHome } from "../lib/config.ts";
import { confirm, err, interactive, ok, pick, spinner, warn } from "../lib/ui.ts";
import { envList, readConfig, scopedSkillsDir, setEnvList, setSkill, skillPath, writeConfig } from "./skill.ts";

// where `npx skills add -g` keeps its lock file and the skill folders (same logic as the skills CLI)
const lockPath = () => {
  const xdg = Deno.env.get("XDG_STATE_HOME");
  return xdg ? join(xdg, "skills", ".skill-lock.json") : join(home(), ".agents", ".skill-lock.json");
};
const globalDir = () => join(home(), ".agents", "skills");
const dirName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "").slice(0, 255) || "unnamed-skill";
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

export const migrate = new Command("migrate")
  .description("Import skills installed globally with `npx skills` into sofa, optionally removing the originals")
  .option("-l, --local", "import into sofa.local.yaml and skills.local/, not synced with git")
  .action(async (opts) => {
    const doc = await readConfig(opts.local);
    const lock = await Deno.readTextFile(lockPath()).then(JSON.parse, () => ({}));
    const locked = Object.entries((lock.skills ?? {}) as Record<string, { source: string; sourceType?: string }>);
    const known = doc.toJS()?.skills ?? {};

    let found = [];
    for (const [name, e] of locked) {
      const dir = dirName(name);
      if (dir in known || await skillPath(dir)) continue; // already in sofa
      if (await exists(join(globalDir(), dir))) found.push({ name, dir, ...e });
      else warn(`${bold(name)}: in ${dim(lockPath())} but ${dim(join(globalDir(), dir))} is missing, skipped`);
    }
    if (!found.length) return ok("nothing to migrate");

    if (interactive()) {
      const names = await pick(
        "Import which skills into sofa?",
        found.map((s) => ({ value: s.name, name: `${s.name} ${dim(s.source)}`, checked: true })),
      );
      found = found.filter((s) => names.includes(s.name));
      if (!found.length) return;
    }
    const envNames = Object.keys((await loadConfig(sofaHome()).catch(() => null))?.environments ?? {});
    const envs = envNames.length && interactive()
      ? await pick("Add to environments? (enter to skip)", envNames.map((value) => ({ value, checked: value === "base" })))
      : [];

    const destRoot = scopedSkillsDir(opts.local);
    await Deno.mkdir(destRoot, { recursive: true });
    for (const s of found) {
      await cp(join(globalDir(), s.dir), join(destRoot, s.dir), { recursive: true });
      setSkill(doc, s.dir, s.sourceType === "local" ? { path: `./${basename(destRoot)}/${s.dir}` } : { source: s.source, skill: s.name });
      for (const e of envs) setEnvList(doc, e, "skills", [...new Set([...envList(doc, e, "skills"), s.dir])]);
      await writeConfig(doc, opts.local);
      ok(`${bold(s.name)} ${dim(`← ${s.source}${envs.length ? ` → ${envs.join(", ")}` : ""}`)}`);
    }

    if (!interactive() || !await confirm(`Remove the ${found.length} originals globally (npx skills remove -g)?`)) {
      return console.log(dim(`  originals kept; sofa env use -g skips skill folders it didn't create`));
    }
    const stop = spinner("Removing originals …");
    const res = await new Deno.Command("npx", {
      args: ["-y", "skills", "remove", "-g", "-y", ...found.map((s) => s.name)],
      env: { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", npm_config_update_notifier: "false" },
      stdin: "null",
    }).output().finally(stop);
    if (!res.success) return err(`skills remove failed:\n${new TextDecoder().decode(res.stderr)}`);
    ok(`originals removed, run ${bold("sofa env use -g")} to link the sofa copies`);
  });
