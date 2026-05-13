#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);
const REPO = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const HOME = os.homedir();
const PAYLOAD = path.join(REPO, "payload", "openrouter-claude-proxy");
const CLAUDE_ASSETS = path.join(REPO, "payload", "claude-assets");
const WRAPPERS = path.join(REPO, "wrappers");
const TEMPLATES = path.join(REPO, "templates");
const TARGET_PROXY = path.join(HOME, ".claude", "openrouter-claude-proxy");
const TARGET_SKILLS = path.join(HOME, ".claude", "skills");
const TARGET_AGENTS = path.join(HOME, ".claude", "agents");
const TARGET_SETTINGS = path.join(HOME, ".claude", "settings.json");
const TARGET_LOCAL_BIN = path.join(HOME, ".local", "bin");
const TARGET_LAUNCH_AGENT = path.join(HOME, "Library", "LaunchAgents", "com.codex.openrouter-claude-proxy.plist");
const TARGET_VSCODE_SETTINGS = path.join(HOME, "Library", "Application Support", "Code", "User", "settings.json");
const BACKUP_ROOT = path.join(HOME, ".claude", "installer-backups");
const LABEL = "com.codex.openrouter-claude-proxy";

const REQUIRED_PROXY_FILES = [
  "server.mjs",
  "doctor.mjs",
  "patch-extension.mjs",
  "modelctl.mjs",
  "claude-low.mjs",
  "claude-env.mjs",
  "safe-update.mjs",
  "model-registry.json",
  "package.json",
  "README.md",
];

const WRAPPER_FILES = [
  "claude-router",
  "or-model",
  "claude-model",
  "claude-role",
  "claude-low",
  "claude-full",
  "claude-kimi",
  "claude-qwen",
  "claude-deepseek",
  "claude-safe-update",
];

const SKILL_DIRS = [
  "frontend-design",
  "ship-feature",
  "debug-loop",
  "code-review",
  "saas-architecture",
];

const AGENT_FILES = [
  "ui-designer.md",
  "frontend-reviewer.md",
  "test-runner.md",
  "architect.md",
  "researcher.md",
];

function usage() {
  return `Usage: ./install.sh [--dry-run] [--merge|--fresh|--upgrade] [--yes]

Default: --merge

Options:
  --dry-run           Print preflight + write plan only
  --merge             Merge into existing ~/.claude/settings.json, preserve unrelated keys
  --fresh             Refuse if existing Claude setup is non-empty
  --upgrade           Same as merge, but label intent as upgrade
  --yes               Skip confirmation prompt
  --api-key-env NAME  Read OpenRouter key from env var NAME
  -h, --help          Show help
`;
}

function parseArgs(argv) {
  const opts = { mode: "merge", dryRun: false, yes: false, apiKeyEnv: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--merge") opts.mode = "merge";
    else if (arg === "--fresh") opts.mode = "fresh";
    else if (arg === "--upgrade") opts.mode = "upgrade";
    else if (arg === "--yes") opts.yes = true;
    else if (arg === "--api-key-env") opts.apiKeyEnv = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function run(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout ?? 20_000,
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
      env: options.env ?? process.env,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), command, args };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
      command,
      args,
      code: error.code ?? null,
      signal: error.signal ?? null,
    };
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function maybeJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

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

async function findCommand(name) {
  const out = await run("zsh", ["-lc", `command -v ${name}`]);
  return out.ok ? out.stdout.split("\n")[0] : null;
}

function versionOf(text) {
  return String(text || "").match(/\d+\.\d+\.\d+/)?.[0] || null;
}

function gteVersion(actual, minimum) {
  const a = String(actual || "").split(".").map(Number);
  const b = String(minimum || "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

async function readDirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function extensionVersions() {
  const dir = path.join(HOME, ".vscode", "extensions");
  const entries = await readDirSafe(dir);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("anthropic.claude-code-"))
    .map((entry) => entry.name.replace(/^anthropic\.claude-code-/, ""));
}

function installHint() {
  return [
    "Install official Claude Code CLI first:",
    "  curl -fsSL https://claude.ai/install.sh | bash",
    "Then verify:",
    "  type -a claude",
    "  claude --version",
    "Then rerun:",
    "  ./install.sh --dry-run",
    "  ./install.sh --merge",
  ].join("\n");
}

async function port4141() {
  const out = await run("lsof", ["-nP", "-iTCP:4141", "-sTCP:LISTEN"]);
  return {
    listening: out.ok && out.stdout.includes("LISTEN"),
    output: out.stdout.split("\n").slice(0, 5),
  };
}

async function diskFreeKb() {
  const out = await run("df", ["-Pk", HOME]);
  if (!out.ok) return null;
  const cols = out.stdout.split("\n").at(-1)?.trim().split(/\s+/) || [];
  return Number(cols[3]) || null;
}

async function preflight(opts) {
  const nodeVersion = process.versions.node;
  const claudePath = await findCommand("claude");
  const codePath = await findCommand("code");
  const zshPath = await findCommand("zsh");
  const claudeVersionOut = claudePath ? await run(claudePath, ["--version"]) : { ok: false, stdout: "" };
  const codeVersionOut = codePath ? await run(codePath, ["--version"]) : { ok: false, stdout: "" };
  const settings = await maybeJson(TARGET_SETTINGS);
  const claudeDirEntries = await readDirSafe(path.join(HOME, ".claude"));
  const launchAgentExists = await exists(TARGET_LAUNCH_AGENT);
  const manifest = await maybeJson(path.join(REPO, "manifest.json"));
  const report = {
    repo: REPO,
    mode: opts.mode,
    dryRun: opts.dryRun,
    os: "macOS",
    platform: process.platform,
    arch: process.arch,
    macOS: (await run("sw_vers", ["-productVersion"])).stdout || null,
    home: HOME,
    node: { version: nodeVersion, ok: gteVersion(nodeVersion, "20.0.0") },
    zsh: { path: zshPath, ok: Boolean(zshPath) },
    path: { localBinInPath: String(process.env.PATH || "").split(":").includes(path.join(HOME, ".local", "bin")) },
    claudeCli: { path: claudePath, version: versionOf(claudeVersionOut.stdout), output: claudeVersionOut.stdout, ok: Boolean(claudePath && claudeVersionOut.ok) },
    vscode: {
      codePath,
      version: codeVersionOut.stdout.split("\n")[0] || null,
      extensions: await extensionVersions(),
      optional: true,
    },
    existingClaudeDir: { exists: claudeDirEntries.length > 0, entries: claudeDirEntries.map((entry) => entry.name).slice(0, 30) },
    existingSettings: {
      exists: Boolean(settings),
      hasAuthToken: Boolean(settings?.env?.ANTHROPIC_AUTH_TOKEN),
      mergeStrategy: opts.mode === "fresh" ? "refuse-if-existing" : "preserve-unrelated-keys-and-token",
    },
    launchAgent: { path: TARGET_LAUNCH_AGENT, exists: launchAgentExists },
    port4141: await port4141(),
    disk: { availableKb: await diskFreeKb(), minRequiredKb: 800_000 },
    claudeDesktop: {
      detected: await exists(path.join(HOME, "Library", "Application Support", "Claude")),
      action: "detect-only-never-touch",
    },
    caveman: {
      detected: await exists(path.join(HOME, ".claude", "plugins", "cache", "caveman")),
      action: "detect-only-never-touch",
    },
    manifest: {
      ltsVersion: manifest?.ltsVersion || null,
      exists: Boolean(manifest),
    },
  };
  const blockers = [];
  const warnings = [];
  if (process.platform !== "darwin") blockers.push("macOS required");
  if (process.arch !== "arm64") blockers.push("Apple Silicon arm64 required");
  if (!report.node.ok) blockers.push("Node >=20 required");
  if (!report.zsh.ok) blockers.push("zsh missing");
  if (!report.claudeCli.ok) blockers.push(`Original Claude Code CLI missing.\n${installHint()}`);
  if (!report.path.localBinInPath) warnings.push(`~/.local/bin is not in PATH. Add: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`);
  if (!report.vscode.codePath) warnings.push("VS Code CLI `code` not found. CLI install can continue; VS Code settings/patching will be skipped.");
  if (report.vscode.codePath && report.vscode.extensions.length === 0) warnings.push("Claude Code VS Code extension not found. Install `anthropic.claude-code`, then run patch-extension manually.");
  if (opts.mode === "fresh" && report.existingClaudeDir.exists) blockers.push("--fresh requires empty or absent ~/.claude");
  if ((report.disk.availableKb || 0) < report.disk.minRequiredKb) blockers.push("not enough free disk");
  report.warnings = warnings;
  report.blockers = blockers;
  report.ok = blockers.length === 0;
  return report;
}

async function verifyManifest() {
  const manifestPath = path.join(REPO, "manifest.json");
  const manifest = await maybeJson(manifestPath);
  if (!manifest) throw new Error("manifest.json missing. Run: node scripts/build-manifest.mjs");
  const failures = [];
  for (const [rel, expected] of Object.entries(manifest.files || {})) {
    const file = path.join(REPO, rel);
    if (!(await exists(file))) {
      failures.push({ file: rel, error: "missing" });
      continue;
    }
    const stat = await fs.stat(file);
    const hash = await sha256(file);
    if (stat.size !== expected.size || hash !== expected.sha256) {
      failures.push({ file: rel, expected, actual: { size: stat.size, sha256: hash } });
    }
  }
  return { ok: failures.length === 0, failures };
}

function render(text, nodePath) {
  return text
    .replaceAll("__HOME__", HOME)
    .replaceAll("__NODE__", nodePath);
}

async function backupFile(file, backupDir, plan) {
  if (!(await exists(file))) return;
  const rel = file.startsWith(HOME) ? path.relative(HOME, file) : path.basename(file);
  const dest = path.join(backupDir, rel);
  plan.push({ action: "backup", from: file, to: dest });
}

async function copyFileWithBackup(src, dest, backupDir, nodePath, mode, plan) {
  await backupFile(dest, backupDir, plan);
  plan.push({ action: "write", from: src, to: dest, mode });
}

function settingsTemplate(apiKey) {
  return {
    env: {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4141",
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_API_KEY: "",
      DISABLE_TELEMETRY: "1",
      DISABLE_AUTOUPDATER: "1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek/deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "DeepSeek V4 Pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: "Hard reasoning and large-context coding candidate. Observed billing must be measured per provider.",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "moonshotai/kimi-k2.6",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Kimi K2.6",
      ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: "Main model for coding, feature implementation, refactors, and production-grade project building.",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "qwen/qwen3.6-plus",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Qwen 3.6 Plus",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: "Cheap full-mode, subagent, and low-token candidate.",
      CLAUDE_CODE_SUBAGENT_MODEL: "qwen/qwen3.6-plus",
      ANTHROPIC_CUSTOM_MODEL_OPTION: "z-ai/glm-5.1",
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "GLM 5.1",
      ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: "Comparison model.",
    },
    model: "sonnet",
    alwaysThinkingEnabled: false,
    effortLevel: "high",
    enabledPlugins: {
      "caveman@caveman": false,
    },
  };
}

function mergeSettings(existing, apiKey) {
  const next = structuredClone(existing || {});
  const template = settingsTemplate(apiKey || existing?.env?.ANTHROPIC_AUTH_TOKEN || "");
  next.env = { ...(existing?.env || {}), ...template.env };
  next.env.ANTHROPIC_AUTH_TOKEN = apiKey || existing?.env?.ANTHROPIC_AUTH_TOKEN || "";
  next.enabledPlugins = { ...(existing?.enabledPlugins || {}), ...template.enabledPlugins };
  next.model = template.model;
  next.alwaysThinkingEnabled = false;
  next.effortLevel = existing?.effortLevel || template.effortLevel;
  return next;
}

async function promptApiKey(existingToken, opts) {
  if (existingToken) return existingToken;
  if (opts.apiKeyEnv && process.env[opts.apiKeyEnv]) return process.env[opts.apiKeyEnv];
  if (opts.dryRun) return "OPENROUTER_KEY_ENTERED_DURING_REAL_INSTALL";
  const key = await readSecret("Enter OpenRouter API key: ");
  if (!key.trim()) throw new Error("OpenRouter API key required");
  return key.trim();
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    const value = await rl.question(prompt);
    rl.close();
    return value;
  }
  return await new Promise((resolve) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (char === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        process.exit(130);
      } else if (char === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function buildPlan(opts, report) {
  const nodePath = process.execPath;
  const backupDir = path.join(BACKUP_ROOT, `openrouter-lts-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`);
  const plan = [];
  for (const name of REQUIRED_PROXY_FILES) {
    await copyFileWithBackup(path.join(PAYLOAD, name), path.join(TARGET_PROXY, name), backupDir, nodePath, name.endsWith(".mjs") ? 0o755 : 0o644, plan);
  }
  for (const name of WRAPPER_FILES) {
    await copyFileWithBackup(path.join(WRAPPERS, name), path.join(TARGET_LOCAL_BIN, name), backupDir, nodePath, 0o755, plan);
  }
  for (const name of SKILL_DIRS) {
    await copyFileWithBackup(
      path.join(CLAUDE_ASSETS, "skills", name, "SKILL.md"),
      path.join(TARGET_SKILLS, name, "SKILL.md"),
      backupDir,
      nodePath,
      0o644,
      plan,
    );
  }
  for (const name of AGENT_FILES) {
    await copyFileWithBackup(
      path.join(CLAUDE_ASSETS, "agents", name),
      path.join(TARGET_AGENTS, name),
      backupDir,
      nodePath,
      0o644,
      plan,
    );
  }
  await backupFile(TARGET_SETTINGS, backupDir, plan);
  plan.push({ action: "merge-json", to: TARGET_SETTINGS, strategy: opts.mode });
  await backupFile(TARGET_LAUNCH_AGENT, backupDir, plan);
  plan.push({ action: "write-template", from: "templates/launchagent.plist.template", to: TARGET_LAUNCH_AGENT });
  const vscodeEnabled = Boolean(report.vscode.codePath);
  const extensionPatchEnabled = vscodeEnabled && report.vscode.extensions.length > 0;
  if (vscodeEnabled) {
    await backupFile(TARGET_VSCODE_SETTINGS, backupDir, plan);
    plan.push({ action: "merge-json", to: TARGET_VSCODE_SETTINGS, keys: ["claudeCode.useTerminal", "claudeCode.claudeProcessWrapper", "claudeCode.disableLoginPrompt", "claudeCode.preferredLocation", "extensions.autoUpdate", "extensions.autoCheckUpdates"] });
  } else {
    plan.push({ action: "skip", reason: "VS Code CLI not found", target: TARGET_VSCODE_SETTINGS });
  }
  plan.push({ action: "launchctl", command: `bootout/bootstrap gui/${process.getuid?.() ?? 502} ${TARGET_LAUNCH_AGENT}` });
  if (extensionPatchEnabled) {
    plan.push({ action: "patch-extension", command: `${nodePath} ${path.join(TARGET_PROXY, "patch-extension.mjs")}` });
  } else {
    plan.push({ action: "skip", reason: "Claude Code VS Code extension not found", target: "extension patch" });
  }
  plan.push({ action: "verify", command: `${nodePath} ${path.join(TARGET_PROXY, "doctor.mjs")}` });
  return { backupDir, nodePath, plan, vscodeEnabled, extensionPatchEnabled };
}

async function writeRenderedFile(src, dest, nodePath, mode) {
  const text = await fs.readFile(src, "utf8");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, render(text, nodePath));
  await fs.chmod(dest, mode);
}

async function materializeBackups(plan, backupDir) {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  for (const item of plan.filter((entry) => entry.action === "backup")) {
    if (!(await exists(item.from))) continue;
    await fs.mkdir(path.dirname(item.to), { recursive: true });
    await fs.copyFile(item.from, item.to);
  }
}

async function applyInstall(opts, installPlan, apiKey) {
  const { backupDir, nodePath, plan } = installPlan;
  await materializeBackups(plan, backupDir);
  await fs.mkdir(TARGET_PROXY, { recursive: true });
  await fs.mkdir(TARGET_LOCAL_BIN, { recursive: true });
  await fs.mkdir(path.dirname(TARGET_LAUNCH_AGENT), { recursive: true });
  await fs.mkdir(path.dirname(TARGET_VSCODE_SETTINGS), { recursive: true });
  await fs.mkdir(path.join(HOME, ".claude", "logs"), { recursive: true });

  for (const name of REQUIRED_PROXY_FILES) {
    await writeRenderedFile(path.join(PAYLOAD, name), path.join(TARGET_PROXY, name), nodePath, name.endsWith(".mjs") ? 0o755 : 0o644);
  }
  for (const name of WRAPPER_FILES) {
    await writeRenderedFile(path.join(WRAPPERS, name), path.join(TARGET_LOCAL_BIN, name), nodePath, 0o755);
  }

  const existingSettings = await maybeJson(TARGET_SETTINGS);
  const mergedSettings = mergeSettings(existingSettings, apiKey);
  await fs.writeFile(TARGET_SETTINGS, JSON.stringify(mergedSettings, null, 2) + "\n", { mode: 0o600 });

  const launchTemplate = await fs.readFile(path.join(TEMPLATES, "launchagent.plist.template"), "utf8");
  await fs.writeFile(TARGET_LAUNCH_AGENT, render(launchTemplate, nodePath), { mode: 0o644 });

  if (installPlan.vscodeEnabled) {
    const existingVsCode = await maybeJson(TARGET_VSCODE_SETTINGS) || {};
    const nextVsCode = {
      ...existingVsCode,
      "claudeCode.useTerminal": true,
      "claudeCode.claudeProcessWrapper": path.join(HOME, ".local", "bin", "claude-full"),
      "claudeCode.disableLoginPrompt": true,
      "claudeCode.preferredLocation": "panel",
    };
    await fs.writeFile(TARGET_VSCODE_SETTINGS, JSON.stringify(nextVsCode, null, 2) + "\n");
  }

  const uid = process.getuid?.() ?? 502;
  await run("launchctl", ["bootout", `gui/${uid}`, TARGET_LAUNCH_AGENT], { timeout: 20_000 });
  const bootstrap = await run("launchctl", ["bootstrap", `gui/${uid}`, TARGET_LAUNCH_AGENT], { timeout: 20_000 });
  if (!bootstrap.ok) throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr}`);

  let patch = { ok: true, stdout: "skipped: Claude Code VS Code extension not found" };
  if (installPlan.extensionPatchEnabled) {
    patch = await run(nodePath, [path.join(TARGET_PROXY, "patch-extension.mjs")], { timeout: 60_000 });
    if (!patch.ok) throw new Error(`patch-extension failed: ${patch.stderr}`);
  }

  const verification = await verifyInstalled(nodePath);
  if (!verification.ok) throw new Error(`post-install verification failed: ${JSON.stringify(verification, null, 2)}`);
  return { backupDir, patch: patch.stdout, verification };
}

async function verifyInstalled(nodePath) {
  const checks = [];
  for (const file of ["server.mjs", "doctor.mjs", "patch-extension.mjs", "modelctl.mjs", "safe-update.mjs"]) {
    const out = await run(nodePath, ["--check", path.join(TARGET_PROXY, file)]);
    checks.push({ name: `node-check:${file}`, ok: out.ok, detail: out.stderr || out.stdout });
  }
  const health = await fetch("http://127.0.0.1:4141/health").then((res) => res.json()).catch((error) => ({ ok: false, error: error.message }));
  checks.push({ name: "proxy-health", ok: health.ok === true, detail: health });
  const patch = await run(nodePath, [path.join(TARGET_PROXY, "patch-extension.mjs"), "--dry-run"]);
  checks.push({ name: "patch-dry-run", ok: patch.ok, detail: patch.stdout.split("\n").filter(Boolean).slice(-5) });
  const doctor = await run(nodePath, [path.join(TARGET_PROXY, "doctor.mjs")], { timeout: 60_000 });
  checks.push({ name: "doctor", ok: doctor.ok, detail: doctor.ok ? "ok" : doctor.stderr });
  return { ok: checks.every((check) => check.ok), checks };
}

async function confirmOrExit(opts, report, plan) {
  console.log(JSON.stringify({ preflight: report, plan }, null, 2));
  if (opts.dryRun) return false;
  if (!report.ok) throw new Error(`Preflight blocked install: ${report.blockers.join("; ")}`);
  if (opts.yes) return true;
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Proceed with install? Type YES: ");
  rl.close();
  if (answer !== "YES") {
    console.log("Aborted.");
    return false;
  }
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  const report = await preflight(opts);
  const manifestCheck = await verifyManifest();
  report.manifest.hashesOk = manifestCheck.ok;
  if (!manifestCheck.ok) report.blockers.push("manifest hash verification failed");
  report.ok = report.blockers.length === 0;
  const installPlan = await buildPlan(opts, report);
  const proceed = await confirmOrExit(opts, report, installPlan.plan);
  if (!proceed) return;
  const existingSettings = await maybeJson(TARGET_SETTINGS);
  const apiKey = await promptApiKey(existingSettings?.env?.ANTHROPIC_AUTH_TOKEN, opts);
  const result = await applyInstall(opts, installPlan, apiKey);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
