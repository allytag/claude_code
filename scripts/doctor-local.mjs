#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), ".."));

async function run(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 20_000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() || "", stderr: error.stderr?.trim() || error.message };
  }
}

const files = [
  "scripts/install.mjs",
  "scripts/build-manifest.mjs",
  "scripts/redact-check.mjs",
  "scripts/doctor-local.mjs",
  "payload/openrouter-claude-proxy/server.mjs",
  "payload/openrouter-claude-proxy/doctor.mjs",
  "payload/openrouter-claude-proxy/patch-extension.mjs",
  "payload/openrouter-claude-proxy/modelctl.mjs",
  "payload/openrouter-claude-proxy/claude-low.mjs",
  "payload/openrouter-claude-proxy/claude-env.mjs",
  "payload/openrouter-claude-proxy/safe-update.mjs",
];

const checks = [];
for (const rel of files) {
  const out = await run("node", ["--check", path.join(REPO, rel)]);
  checks.push({ name: rel, ok: out.ok, detail: out.stderr || out.stdout });
}

for (const rel of ["install.sh", "verify.sh", "uninstall.sh", ...await fs.readdir(path.join(REPO, "wrappers")).then((xs) => xs.map((x) => `wrappers/${x}`))]) {
  const out = await run("zsh", ["-n", path.join(REPO, rel)]);
  checks.push({ name: rel, ok: out.ok, detail: out.stderr });
}

const manifest = JSON.parse(await fs.readFile(path.join(REPO, "manifest.json"), "utf8"));
checks.push({ name: "manifest", ok: Boolean(manifest.ltsVersion && manifest.files), detail: manifest.ltsVersion });

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
