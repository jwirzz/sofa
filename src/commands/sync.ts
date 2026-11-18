import { Command } from "@commander-js/extra-typings";
import { adapters } from "../adapters/mod.ts";
import { loadConfig, loadState, resolveMcps, saveState } from "../config.ts";
import { sofaHome } from "./init.ts";

export const sync = new Command("sync")
  .description("Write MCP servers from sofa.yaml into every configured agent")
  .option("-e, --env <names...>", "environments to activate (besides base)")
  .option("-n, --dry-run", "show what would change without writing")
  .action(async (opts) => {
    const dir = sofaHome();
    try {
      const cfg = await loadConfig(dir);
      const state = await loadState(dir);
      const envs = opts.env ?? state.active;
      const names = resolveMcps(cfg, envs);
      console.log(
        `Environments: base${envs.length ? " + " + envs.join(", ") : ""}`,
      );

      for (const id of cfg.agents) {
        const adapter = adapters[id];
        if (!adapter) {
          console.warn(
            `! ${id}: no adapter (supported: ${
              Object.keys(adapters).join(", ")
            })`,
          );
          continue;
        }
        const servers = Object.fromEntries(
          names
            .filter((n) => !cfg.mcps[n].only || cfg.mcps[n].only!.includes(id))
            .map((n) => [n, cfg.mcps[n]]),
        );
        try {
          const r = await adapter.apply(
            servers,
            state.owned[id] ?? [],
            !!opts.dryRun,
          );
          state.owned[id] = r.written;
          const status = r.changed
            ? (opts.dryRun ? "would update" : "updated")
            : "in sync";
          console.log(
            `${
              r.changed ? "~" : "="
            } ${adapter.label}: ${status} (${r.written.length} MCPs) ${adapter.path()}`,
          );
          for (const s of r.skipped) {
            console.warn(
              `  ! "${s}" already exists unmanaged - left untouched`,
            );
          }
        } catch (e) {
          console.error(
            `x ${adapter.label}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      if (!opts.dryRun) {
        if (opts.env) state.active = opts.env;
        await saveState(dir, state);
      }
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      Deno.exit(1);
    }
  });
