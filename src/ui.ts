import { Checkbox, Confirm, Input, Select } from "@cliffy/prompt";
import { green, red, yellow } from "@std/fmt/colors";

export const ok = (msg: string) => console.log(`${green("✓")} ${msg}`);
export const warn = (msg: string) => console.error(`${yellow("!")} ${msg}`);

export function err(msg: string) {
  console.error(`${red("✗")} ${msg}`);
  Deno.exitCode = 1;
}

export function fail(msg: string): never {
  console.error(`${red("✗")} ${msg}`);
  Deno.exit(1);
}

// prompts only make sense when a human is at the keyboard
export const interactive = () => Deno.stdin.isTerminal() && Deno.stdout.isTerminal();

type Option = { value: string; name?: string; checked?: boolean };

export const pick = (message: string, options: Option[]) =>
  Checkbox.prompt({
    message,
    options,
    confirmSubmit: false,
    hint: "space: select · ctrl+a: all · enter: confirm",
    search: options.length > 10,
  });

export const choose = (message: string, options: Option[]) => Select.prompt({ message, options });

export const ask = (message: string, validate?: (v: string) => boolean | string) =>
  Input.prompt({ message, validate });

export function spinner(text: string) {
  if (!Deno.stderr.isTerminal()) return () => {};
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const enc = new TextEncoder();
  let i = 0;
  const id = setInterval(() => Deno.stderr.writeSync(enc.encode(`\r${frames[i++ % frames.length]} ${text}`)), 80);
  return () => {
    clearInterval(id);
    Deno.stderr.writeSync(enc.encode("\r\x1b[K"));
  };
}

export const confirm = (message: string) => Confirm.prompt({ message, default: false });
