import { Command } from "@commander-js/extra-typings";
import { bold, dim, green } from "@std/fmt/colors";
import { adapters } from "../lib/adapters/mod.ts";
import { loadConfig, loadState, sofaHome } from "../lib/config.ts";
import { fail } from "../lib/ui.ts";

const list = new Command("list")
  .alias("ls")
  .description("List MCP servers from sofa.yaml and the agents they are written to")
  .action(async () => {
    const cfg = await loadConfig(sofaHome()).catch((e) => fail(e.message));
    const { owned } = await loadState(sofaHome());
    const names = Object.keys(cfg.mcps);
    if (!names.length) return console.log(dim("no MCPs in sofa.yaml"));
    const width = Math.max(...names.map((n) => n.length));
    for (const n of names) {
      const s = cfg.mcps[n] ?? {};
      // headers and env are left out on purpose: they often hold tokens
      const runs = s.url ?? [s.command, ...(s.args ?? [])].join(" ");
      const envs = Object.entries(cfg.environments).filter(([, e]) => e?.mcps?.includes(n)).map(([e]) => e);
      const agents = Object.entries(owned).filter(([, ms]) => ms.includes(n)).map(([id]) => adapters[id]?.label ?? id);
      const details = [
        runs,
        `envs: ${envs.join(", ") || "-"}`,
        agents.length && `in: ${agents.join(", ")}`,
        s.only && `only: ${s.only.join(", ")}`,
      ].filter(Boolean);
      console.log(`${agents.length ? green("●") : dim("○")} ${bold(n.padEnd(width))}  ${dim(details.join(" · "))}`);
    }
  });

export const mcp = new Command("mcp")
  .description("MCP servers from sofa.yaml (activate them with sofa env use -g)")
  .addCommand(list);
