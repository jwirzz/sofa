import { Command } from "@commander-js/extra-typings";

export const init = new Command("init")
  .description("Init sofa configuration")
  .option("--from <string>", "git repo")
  .action((opts) => {
    console.log(`init ran with option ${opts.from}`);
  });
