import { buildProgram } from "./src/cli.ts";

if (import.meta.main) {
  await buildProgram().parseAsync(Deno.args, { from: "user" });
}
