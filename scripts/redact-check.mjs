#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const BLOCKED_NAMES = [
  /\.DS_Store$/,
  /\.jsonl$/,
  /openrouter-claude-proxy.*\.log$/,
  /last-metrics\.json$/,
  /last-safe-update\.json$/,
  /codex-backup/,
  /opus-backup/,
  /\.failed-/,
  /state\.vscdb\.backup$/,
];
const BLOCKED_TEXT = [
  /sk-or-[A-Za-z0-9_-]{10,}/,
  /ANTHROPIC_AUTH_TOKEN"\s*:\s*"sk-/,
  /\/Users\/apple/,
  /vivek[a-z0-9._%+-]*@/i,
];

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

const failures = [];
for (const file of await walk(REPO)) {
  const rel = path.relative(REPO, file);
  if (BLOCKED_NAMES.some((re) => re.test(rel))) failures.push({ file: rel, reason: "blocked-name" });
  const stat = await fs.stat(file);
  if (stat.size > 2_500_000) continue;
  const text = await fs.readFile(file, "utf8").catch(() => "");
  for (const re of BLOCKED_TEXT) {
    if (re.test(text)) failures.push({ file: rel, reason: `blocked-text:${re}` });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked: "repo", secretLeaks: 0 }, null, 2));
