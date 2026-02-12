#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'ops/contracts/negrisk-milestones.json');
const outDir = path.join(root, 'artifacts/negrisk/preflight');
fs.mkdirSync(outDir, { recursive: true });

const c = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const errors = [];
const checks = [];

const exists = (p) => fs.existsSync(path.join(root, p));

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc.replace(/\*/g, '.*') + '$');
}

function countMatches(globPath) {
  const absBase = path.join(root, path.dirname(globPath));
  const base = path.basename(globPath);
  if (!fs.existsSync(absBase)) return 0;
  const re = globToRegex(base);
  return fs.readdirSync(absBase).filter((f) => re.test(f)).length;
}

for (const m of c.milestones || []) {
  for (const cmd of m.verify || []) {
    let pass = true;
    let reason = '';

    if (cmd.includes('run-goal.mjs') || cmd.includes('npm run goal')) {
      const goal = cmd.match(/\b(G\d+)\b/)?.[1];
      const pack = cmd.match(/--pack\s+([^\s]+)/)?.[1];
      if (!goal || !pack || !exists(pack)) {
        pass = false;
        reason = 'goalpack_or_goal_missing';
      } else {
        const packJson = JSON.parse(fs.readFileSync(path.join(root, pack), 'utf8'));
        if (!(packJson.goals || []).some((g) => g.id === goal)) {
          pass = false;
          reason = 'goal_id_not_found';
        }
      }
    }

    if (cmd.includes('npm test --')) {
      const testArg = cmd.split('npm test --')[1]?.trim();
      if (testArg?.includes('*')) {
        const matches = countMatches(testArg);
        if (matches === 0) {
          pass = false;
          reason = reason || 'test_glob_matches_zero';
        }
      }
    }

    checks.push({ milestone: m.id, type: 'verify_cmd', cmd, pass, reason });
    if (!pass) errors.push({ milestone: m.id, cmd, reason });
  }

  for (const art of m.artifacts || []) {
    const parent = path.dirname(art);
    const pass = exists(parent);
    checks.push({ milestone: m.id, type: 'artifact_parent', path: art, pass, reason: pass ? '' : 'artifact_parent_missing' });
    if (!pass) errors.push({ milestone: m.id, artifact: art, reason: 'artifact_parent_missing' });
  }
}

const out = { ok: errors.length === 0, generatedAt: new Date().toISOString(), errors, checks };
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, errorCount: errors.length, report: 'artifacts/negrisk/preflight/latest.json' }));
process.exit(out.ok ? 0 : 2);
