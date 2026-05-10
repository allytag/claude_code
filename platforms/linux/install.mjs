#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../..");
const PAYLOAD = path.join(REPO, "payload", "openrouter-claude-proxy");
const WRAPPERS = path.join(HERE, "wrappers");
const SERVICE_TEMPLATE = path.join(HERE, "systemd", "openrouter-claude-proxy.service.template");
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

function usage() {
  return `Usage: node platforms/linux/install.mjs [--dry-run] [--merge|--fresh|--upgrade] [--yes]

Linux support is beta until verified on a real Linux machine.

Options:
  --dry-run              Print preflight + write plan only
  --merge                Merge with existing ~/.claude/settings.json (default)
  --fresh                Refuse if ~/.claude is non-empty
  --upgrade              Same behavior as merge, labels intent as upgrade
  --yes                  Skip confirmation prompt
  --api-key-env NAME     Read OpenRouter key from env var NAME
  --fake-home PATH       Test-only target home for dry-run validation
  --skip-platform-check  Test-only; lets static validation run on non-Linux
  -h, --help             Show help
`;
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    mode: "merge",
    yes: false,
    apiKeyEnv: null,
    fakeHome: null,
    skipPlatformCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--merge") opts.mode = "merge";
    else if (arg === "--fresh") opts.mode = "fresh";
    else if (arg === "--upgrade") opts.mode = "upgrade";
    else if (arg === "--yes") opts.yes = true;
    else if (arg === "--api-key-env") opts.apiKeyEnv = argv[++i];
    else if (arg === "--fake-home") opts.fakeHome = argv[++i];
    else if (arg === "--skip-platform-check") opts.skipPlatformCheck = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function run(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout ?? 20_000,
      maxBuffer: 20 * 1024 * 1024,
      env: options.env ?? process.env,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
      code: error.code ?? null,
    };
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function findCommand(name) {
  const out = await run("sh", ["-lc", `command -v ${name}`]);
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

function targets(home) {
  return {
    home,
    proxy: path.join(home, ".claude", "openrouter-claude-proxy"),
    settings: path.join(home, ".claude", "settings.json"),
    localBin: path.join(home, ".local", "bin"),
    service: path.join(home, ".config", "systemd", "user", "openrouter-claude-proxy.service"),
    vscodeSettings: path.join(home, ".config", "Code", "User", "settings.json"),
    backupRoot: path.join(home, ".claude", "installer-backups"),
    logs: path.join(home, ".claude", "logs"),
  };
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
    enabledPlugins: { "caveman@caveman": false },
  };
}

function mergeSettings(existing, apiKey) {
  const template = settingsTemplate(apiKey || existing?.env?.ANTHROPIC_AUTH_TOKEN || "");
  const next = structuredClone(existing || {});
  next.env = { ...(existing?.env || {}), ...template.env };
  next.env.ANTHROPIC_AUTH_TOKEN = apiKey || existing?.env?.ANTHROPIC_AUTH_TOKEN || "";
  next.enabledPlugins = { ...(existing?.enabledPlugins || {}), ...template.enabledPlugins };
  next.model = template.model;
  next.alwaysThinkingEnabled = false;
  next.effortLevel = existing?.effortLevel || template.effortLevel;
  return next;
}

async function preflight(opts, t) {
  const claudePath = await findCommand("claude");
  const codePath = await findCommand("code");
  const systemctlPath = await findCommand("systemctl");
  const claudeVersion = claudePath ? await run(claudePath, ["--version"]) : { ok: false, stdout: "" };
  const codeVersion = codePath ? await run(codePath, ["--version"]) : { ok: false, stdout: "" };
  const settings = await readJson(t.settings);
  const claudeEntries = await fs.readdir(path.join(t.home, ".claude")).catch(() => []);
  const report = {
    repo: REPO,
    status: "linux-beta-static-validated",
    mode: opts.mode,
    dryRun: opts.dryRun,
    platform: process.platform,
    arch: process.arch,
    home: t.home,
    node: { path: process.execPath, version: process.versions.node, ok: gteVersion(process.versions.node, "20.0.0") },
    claudeCli: { path: claudePath, version: versionOf(claudeVersion.stdout), output: claudeVersion.stdout, ok: Boolean(claudePath && claudeVersion.ok) },
    vscode: { codePath, version: codeVersion.stdout.split("\n")[0] || null, optional: true },
    systemd: { systemctlPath, userServicePath: t.service, ok: Boolean(systemctlPath) },
    existingClaudeDir: { exists: claudeEntries.length > 0, entries: claudeEntries.slice(0, 30) },
    existingSettings: { exists: Boolean(settings), hasAuthToken: Boolean(settings?.env?.ANTHROPIC_AUTH_TOKEN) },
    warnings: [],
    blockers: [],
  };
  if (process.platform !== "linux" && !opts.skipPlatformCheck) report.blockers.push("Linux required. Use macOS installer on macOS.");
  if (!report.node.ok) report.blockers.push("Node >=20 required");
  if (!report.claudeCli.ok && !opts.skipPlatformCheck) report.blockers.push("Original Claude Code CLI missing. Install official Claude Code first.");
  if (!report.systemd.ok) report.warnings.push("systemctl not found. Proxy service cannot be enabled automatically; manual start still possible.");
  if (!String(process.env.PATH || "").split(":").includes(path.join(t.home, ".local", "bin"))) report.warnings.push("~/.local/bin not in PATH");
  if (!codePath) report.warnings.push("VS Code CLI `code` not found. VS Code settings will still be written if settings path exists.");
  if (opts.mode === "fresh" && report.existingClaudeDir.exists) report.blockers.push("--fresh requires empty or absent ~/.claude");
  report.ok = report.blockers.length === 0;
  return report;
}

function render(text, t, nodePath = process.execPath) {
  return text.replaceAll("__HOME__", t.home).replaceAll("__NODE__", nodePath);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function buildPlan(opts, t) {
  const backupDir = path.join(t.backupRoot, `openrouter-lts-${stamp()}`);
  const plan = [];
  for (const name of REQUIRED_PROXY_FILES) {
    plan.push({ action: "backup-if-exists", from: path.join(t.proxy, name), backupDir });
    plan.push({ action: "write", from: path.join(PAYLOAD, name), to: path.join(t.proxy, name), mode: name.endsWith(".mjs") ? 0o755 : 0o644 });
  }
  for (const name of WRAPPER_FILES) {
    plan.push({ action: "backup-if-exists", from: path.join(t.localBin, name), backupDir });
    plan.push({ action: "write", from: path.join(WRAPPERS, name), to: path.join(t.localBin, name), mode: 0o755 });
  }
  plan.push({ action: "backup-if-exists", from: t.settings, backupDir });
  plan.push({ action: "merge-json", to: t.settings, strategy: opts.mode });
  plan.push({ action: "backup-if-exists", from: t.service, backupDir });
  plan.push({ action: "write-template", from: SERVICE_TEMPLATE, to: t.service });
  plan.push({ action: "backup-if-exists", from: t.vscodeSettings, backupDir });
  plan.push({ action: "merge-json", to: t.vscodeSettings, optional: true });
  plan.push({ action: "systemd-user", command: "systemctl --user daemon-reload && systemctl --user enable --now openrouter-claude-proxy.service" });
  plan.push({ action: "verify", command: `${process.execPath} ${path.join(t.proxy, "doctor.mjs")}` });
  return { backupDir, plan };
}

async function backup(file, backupDir, home) {
  if (!(await exists(file))) return;
  const rel = file.startsWith(home) ? path.relative(home, file) : path.basename(file);
  const dest = path.join(backupDir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(file, dest);
}

async function writeRendered(src, dest, t, mode) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, render(await fs.readFile(src, "utf8"), t));
  await fs.chmod(dest, mode);
}

async function promptApiKey(existingToken, opts) {
  if (existingToken) return existingToken;
  if (opts.apiKeyEnv && process.env[opts.apiKeyEnv]) return process.env[opts.apiKeyEnv];
  if (opts.dryRun) return "OPENROUTER_KEY_ENTERED_DURING_REAL_INSTALL";
  const rl = readline.createInterface({ input, output });
  const value = await rl.question("Enter OpenRouter API key: ");
  rl.close();
  if (!value.trim()) throw new Error("OpenRouter API key required");
  return value.trim();
}

async function applyInstall(opts, t, installPlan, apiKey) {
  await fs.mkdir(installPlan.backupDir, { recursive: true, mode: 0o700 });
  for (const item of installPlan.plan.filter((x) => x.action === "backup-if-exists")) await backup(item.from, item.backupDir, t.home);
  for (const name of REQUIRED_PROXY_FILES) await writeRendered(path.join(PAYLOAD, name), path.join(t.proxy, name), t, name.endsWith(".mjs") ? 0o755 : 0o644);
  for (const name of WRAPPER_FILES) await writeRendered(path.join(WRAPPERS, name), path.join(t.localBin, name), t, 0o755);
  await fs.mkdir(t.logs, { recursive: true });

  const existingSettings = await readJson(t.settings);
  await fs.mkdir(path.dirname(t.settings), { recursive: true });
  await fs.writeFile(t.settings, JSON.stringify(mergeSettings(existingSettings, apiKey), null, 2) + "\n", { mode: 0o600 });

  await writeRendered(SERVICE_TEMPLATE, t.service, t, 0o644);

  const existingVsCode = await readJson(t.vscodeSettings) || {};
  await fs.mkdir(path.dirname(t.vscodeSettings), { recursive: true });
  await fs.writeFile(t.vscodeSettings, JSON.stringify({
    ...existingVsCode,
    "claudeCode.useTerminal": true,
    "claudeCode.claudeProcessWrapper": path.join(t.localBin, "claude-full"),
    "claudeCode.disableLoginPrompt": true,
    "claudeCode.preferredLocation": "panel",
  }, null, 2) + "\n");

  const systemctl = await findCommand("systemctl");
  if (systemctl) {
    await run(systemctl, ["--user", "daemon-reload"]);
    const enabled = await run(systemctl, ["--user", "enable", "--now", "openrouter-claude-proxy.service"], { timeout: 60_000 });
    if (!enabled.ok) throw new Error(`systemctl enable failed: ${enabled.stderr}`);
  }
  return { backupDir: installPlan.backupDir };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  const home = path.resolve(opts.fakeHome || os.homedir());
  const t = targets(home);
  const report = await preflight(opts, t);
  const installPlan = await buildPlan(opts, t);
  console.log(JSON.stringify({ preflight: report, plan: installPlan.plan }, null, 2));
  if (opts.dryRun) return;
  if (!report.ok) throw new Error(`Preflight blocked install: ${report.blockers.join("; ")}`);
  if (!opts.yes) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Proceed with Linux beta install? Type YES: ");
    rl.close();
    if (answer !== "YES") return;
  }
  const existingSettings = await readJson(t.settings);
  const apiKey = await promptApiKey(existingSettings?.env?.ANTHROPIC_AUTH_TOKEN, opts);
  const result = await applyInstall(opts, t, installPlan, apiKey);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
