import { Command } from "@commander-js/extra-typings";
import { greet } from "./commands/greet.ts";
import { init } from "./commands/init.ts";

export function buildProgram() {
  const program = new Command()
    .name("sofa")
    .description("Simple One-File Agent configuration")
    .version("0.1.0");

  program.addCommand(greet);
  program.addCommand(init);
  return program;
}
