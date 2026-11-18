import { Command } from "@commander-js/extra-typings";
import { coverup } from "./commands/coverup.ts";
import { init } from "./commands/init.ts";
import { sync } from "./commands/sync.ts";

const SOFA_ART = String.raw`
 .-="""""""""""=-.
 | . . . . . . . |                __
 | .'.'.'.'.'.'. |     ___  ___  / _| __ _
()_______________()   / __|/ _ \| |_ / _${"`"} |
||_______________||   \__ \ (_) |  _| (_| |
 W               W    |___/\___/|_|  \__,_|
`;

export function buildProgram() {
  const program = new Command()
    .name("sofa")
    .description("Simple One-File Agent configuration")
    .version("0.1.0")
    .addHelpText("beforeAll", SOFA_ART);

  program.addCommand(coverup);
  program.addCommand(init);
  program.addCommand(sync);
  return program;
}
