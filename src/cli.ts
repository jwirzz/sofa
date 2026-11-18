import { Command } from "@commander-js/extra-typings";
import { env } from "./commands/env.ts";
import { init } from "./commands/init.ts";
import { migrate } from "./commands/migrate.ts";
import { mcp } from "./commands/mcp.ts";
import { skill } from "./commands/skill.ts";

export function buildProgram() {
  const program = new Command()
    .name("sofa")
    .description("Simple One-File Agent configuration")
    .version("0.1.0");

  program.addCommand(init);
  program.addCommand(skill);
  program.addCommand(mcp);
  program.addCommand(env);
  program.addCommand(migrate);
  return program;
}
