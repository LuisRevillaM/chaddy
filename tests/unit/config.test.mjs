import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateConfig } from "../../packages/shared/src/validateConfig.js";

test("config/example.json validates", async () => {
  const p = path.join(process.cwd(), "config", "example.json");
  const text = await fs.readFile(p, "utf8");
  const obj = JSON.parse(text);
  assert.equal(validateConfig(obj), true);
});

