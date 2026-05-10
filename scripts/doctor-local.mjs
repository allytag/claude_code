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

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
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

for (const file of await walk(path.join(REPO, "platforms"))) {
  if (file.endsWith(".mjs")) files.push(path.relative(REPO, file));
}

const checks = [];
for (const rel of files) {
  const out = await run("node", ["--check", path.join(REPO, rel)]);
  checks.push({ name: rel, ok: out.ok, detail: out.stderr || out.stdout });
}

for (const rel of ["install.sh", "verify.sh", "uninstall.sh", ...await fs.readdir(path.join(REPO, "wrappers")).then((xs) => xs.map((x) => `wrappers/${x}`))]) {
  const out = await run("zsh", ["-n", path.join(REPO, rel)]);
  checks.push({ name: rel, ok: out.ok, detail: out.stderr });
}

for (const rel of (await walk(path.join(REPO, "platforms", "linux", "wrappers"))).map((file) => path.relative(REPO, file))) {
  const out = await run("sh", ["-n", path.join(REPO, rel)]);
  checks.push({ name: rel, ok: out.ok, detail: out.stderr });
}

for (const rel of (await walk(path.join(REPO, "platforms", "windows", "wrappers"))).map((file) => path.relative(REPO, file))) {
  const text = await fs.readFile(path.join(REPO, rel), "utf8");
  const ok = text.startsWith("@echo off") && text.includes("__HOME__") && (text.includes("__NODE__") || rel.includes("claude-kimi") || rel.includes("claude-qwen") || rel.includes("claude-deepseek"));
  checks.push({ name: rel, ok, detail: ok ? "" : "Windows wrapper missing expected template markers" });
}

for (const [name, args] of [
  ["platforms/linux/install.mjs dry-run", ["platforms/linux/install.mjs", "--dry-run", "--merge", "--fake-home", path.join(REPO, ".tmp-doctor-linux-home"), "--skip-platform-check"]],
  ["platforms/windows/install.mjs dry-run", ["platforms/windows/install.mjs", "--dry-run", "--merge", "--fake-home", path.join(REPO, ".tmp-doctor-windows-home"), "--skip-platform-check"]],
]) {
  const out = await run("node", args.map((arg, index) => index === 0 ? path.join(REPO, arg) : arg));
  checks.push({ name, ok: out.ok, detail: out.stderr || "" });
}

const manifest = JSON.parse(await fs.readFile(path.join(REPO, "manifest.json"), "utf8"));
checks.push({ name: "manifest", ok: Boolean(manifest.ltsVersion && manifest.files), detail: manifest.ltsVersion });

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
