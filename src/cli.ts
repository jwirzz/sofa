import { Command } from "@commander-js/extra-typings";
import { greet } from "./commands/greet.ts";

export function buildProgram() {
  const program = new Command()
    .name("mytool")
    .description("Mein CLI-Tool")
    .version("0.1.0");

  program.addCommand(greet);
  return program;
}
