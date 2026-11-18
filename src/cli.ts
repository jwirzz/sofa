import { Command } from "@commander-js/extra-typings";
import { init } from "./commands/init.ts";
import { sync } from "./commands/sync.ts";

export function buildProgram() {
  const program = new Command()
    .name("sofa")
    .description("Simple One-File Agent configuration")
    .version("0.1.0");

  program.addCommand(init);
  program.addCommand(sync);
  return program;
}
