import { Command } from "@commander-js/extra-typings";

export const greet = new Command("greet")
  .description("Jemanden grüssen")
  .argument("<name>", "Name der Person")
  .option("-l, --loud", "laut grüssen")
  .action((name, opts) => {
    const msg = `Hallo ${name}`;
    console.log(opts.loud ? msg.toUpperCase() : msg);
  });
