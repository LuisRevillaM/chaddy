#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { validateConfig } from "../packages/shared/src/validateConfig.js";

async function main() {
  const p = process.argv[2];
  if (!p) {
    console.error("Usage: node scripts/validate-config.mjs <path-to-config.json>");
    process.exit(2);
  }
  const abs = path.resolve(process.cwd(), p);
  const text = await fs.readFile(abs, "utf8");
  const obj = JSON.parse(text);
  validateConfig(obj);
  console.log("Config OK:", p);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

