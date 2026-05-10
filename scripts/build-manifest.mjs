#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REPO = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const INCLUDE_DIRS = ["payload", "wrappers", "templates", "scripts", "docs", "platforms"];
const INCLUDE_FILES = ["install.sh", "verify.sh", "uninstall.sh", "README.md", "LICENSE", ".gitignore"];

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === ".DS_Store") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

const files = [];
for (const dir of INCLUDE_DIRS) files.push(...await walk(path.join(REPO, dir)));
for (const file of INCLUDE_FILES) {
  const full = path.join(REPO, file);
  if (fsSync.existsSync(full)) files.push(full);
}

const manifest = {
  ltsVersion: "2026.05.07-1",
  generatedAt: new Date().toISOString(),
  platform: "macos-arm64-lts-linux-windows-beta",
  nodeVersionMin: "20.0.0",
  claudeCliMin: "2.1.131",
  claudeCliMax: "2.1.999",
  vscodeExtensionMin: "2.1.131",
  files: {},
};

for (const file of files.sort()) {
  const rel = path.relative(REPO, file);
  const stat = await fs.stat(file);
  manifest.files[rel] = { size: stat.size, sha256: await sha256(file) };
}

await fs.writeFile(path.join(REPO, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${Object.keys(manifest.files).length} files`);
