#!/usr/bin/env bun
import { main } from "../src/main.ts";

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`miniboss: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
