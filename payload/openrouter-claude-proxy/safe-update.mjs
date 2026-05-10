#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "__HOME__/.local/bin/claude";
const VERSIONS_DIR = "__HOME__/.local/share/claude/versions";
const SNAPSHOT_DIR = "__HOME__/.claude/binary-snapshots";
const EXTENSION_SNAPSHOT_DIR = "__HOME__/.claude/extension-snapshots";
const EXTENSIONS_DIR = "__HOME__/.vscode/extensions";
const EXTENSION_PREFIX = "anthropic.claude-code-";
const LOG_DIR = "__HOME__/.claude/logs";
const LAST_SAFE_UPDATE = path.join(LOG_DIR, "last-safe-update.json");
const DOCTOR = "__HOME__/.claude/openrouter-claude-proxy/doctor.mjs";
const PATCHER = "__HOME__/.claude/openrouter-claude-proxy/patch-extension.mjs";
const HEALTH_URL = "http://127.0.0.1:4141/health";
const DOWNLOADS_URL = "https://downloads.claude.ai/claude-code-releases";
const MIN_BINARY_BYTES = 100_000_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_PROBE_BUDGET_USD = 0.25;

function usage() {
  return `Usage: claude-safe-update [target] [options]

Safely install/update Claude Code native build with rollback.

Targets:
  latest | stable | 2.x.y       Default: latest

Options:
  --dry-run                     Run preflight and print plan, no writes or update
  --skip-network                Skip download endpoint TLS preflight
  --timeout-ms <ms>             Installer timeout, default ${DEFAULT_TIMEOUT_MS}
  --skip-extension              Do not update the Claude Code VS Code extension
  --probe                       Optional tiny post-update model probe, skipped unless --allow-model-call also set
  --allow-model-call            Allow --probe to spend OpenRouter tokens
  --probe-budget-usd <amount>   Probe budget ceiling, default ${DEFAULT_PROBE_BUDGET_USD}
  -h, --help                    Show help
`;
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    target: "latest",
    dryRun: false,
    skipNetwork: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    probe: false,
    allowModelCall: false,
    probeBudgetUsd: DEFAULT_PROBE_BUDGET_USD,
    updateExtension: true,
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-network") {
      options.skipNetwork = true;
    } else if (arg === "--skip-extension") {
      options.updateExtension = false;
    } else if (arg === "--probe") {
      options.probe = true;
    } else if (arg === "--allow-model-call") {
      options.allowModelCall = true;
    } else if (arg === "--probe-budget-usd") {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) throw new Error("--probe-budget-usd must be > 0");
      options.probeBudgetUsd = value;
    } else if (arg === "--timeout-ms") {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value < 30_000) throw new Error("--timeout-ms must be >= 30000");
      options.timeoutMs = value;
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (arg) {
      options.target = arg;
    }
  }
  return options;
}

async function run(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout ?? 20_000,
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
      env: options.env ?? process.env,
    });
    return { ok: true, command, args, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (error) {
    return {
      ok: false,
      command,
      args,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
      code: error.code ?? null,
      signal: error.signal ?? null,
      timedOut: error.killed === true,
    };
  }
}

async function pathInfo(file) {
  try {
    const stat = await fs.lstat(file);
    return {
      exists: true,
      isSymlink: stat.isSymbolicLink(),
      mode: stat.mode,
      size: stat.size,
      linkTarget: stat.isSymbolicLink() ? await fs.readlink(file) : null,
      realPath: await fs.realpath(file).catch(() => null),
    };
  } catch {
    return { exists: false };
  }
}

async function executable(file) {
  try {
    await fs.access(file, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function parseVersion(text) {
  return String(text || "").match(/\d+\.\d+\.\d+/)?.[0] || "unknown";
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

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function currentClaudeState() {
  const info = await pathInfo(CLAUDE_BIN);
  const versionOut = await run(CLAUDE_BIN, ["--version"]);
  return {
    bin: CLAUDE_BIN,
    info,
    version: parseVersion(versionOut.stdout),
    versionText: versionOut.stdout,
    versionOk: versionOut.ok,
  };
}

async function createSnapshot(state, dryRun) {
  if (!state.info.exists) throw new Error(`${CLAUDE_BIN} missing`);
  const source = state.info.realPath || CLAUDE_BIN;
  const sourceInfo = await pathInfo(source);
  if (!sourceInfo.exists || sourceInfo.size < MIN_BINARY_BYTES || !(await executable(source))) {
    throw new Error(`current Claude binary is not snapshot-safe: ${source}`);
  }
  const hash = await sha256(source);
  const name = `claude-${safeName(state.version)}-${hash.slice(0, 12)}`;
  const snapshot = path.join(SNAPSHOT_DIR, name);
  const meta = `${snapshot}.json`;
  if (!dryRun) {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
    try {
      await fs.copyFile(source, snapshot, fsSync.constants.COPYFILE_EXCL);
      await fs.chmod(snapshot, 0o755);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await fs.writeFile(meta, JSON.stringify({
      createdAt: new Date().toISOString(),
      version: state.version,
      source,
      sourceSymlink: state.info.linkTarget,
      sha256: hash,
      size: sourceInfo.size,
    }, null, 2));
  }
  return { source, snapshot, meta, sha256: hash, size: sourceInfo.size, exists: !dryRun || fsSync.existsSync(snapshot) };
}

async function listExtensionDirs() {
  try {
    const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_PREFIX))
      .map((entry) => path.join(EXTENSIONS_DIR, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function extensionVersion(dir) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

async function extensionState() {
  const dirs = await listExtensionDirs();
  const extensions = [];
  for (const dir of dirs) {
    extensions.push({
      dir,
      name: path.basename(dir),
      version: await extensionVersion(dir),
    });
  }
  return { extensions };
}

async function createExtensionSnapshot(state, dryRun) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const snapshot = path.join(EXTENSION_SNAPSHOT_DIR, `claude-code-extensions-${stamp}`);
  const dirs = state.extensions || [];

  if (!dryRun) {
    await fs.mkdir(snapshot, { recursive: true, mode: 0o700 });
    for (const ext of dirs) {
      await fs.cp(ext.dir, path.join(snapshot, ext.name), { recursive: true, force: false, errorOnExist: true });
    }
    await fs.writeFile(path.join(snapshot, "snapshot.json"), JSON.stringify({
      createdAt: new Date().toISOString(),
      extensions: dirs,
    }, null, 2));
  }

  return {
    path: snapshot,
    count: dirs.length,
    extensions: dirs,
    exists: !dryRun && fsSync.existsSync(snapshot),
    dryRun,
  };
}

async function restoreExtensionSnapshot(snapshot) {
  if (!snapshot?.path || !fsSync.existsSync(snapshot.path)) {
    return { ok: false, error: "extension snapshot missing", snapshotPath: snapshot?.path || null };
  }

  const current = await listExtensionDirs();
  const quarantined = [];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  for (const dir of current) {
    const dest = `${dir}.failed-safe-update-${stamp}`;
    await fs.rename(dir, dest);
    quarantined.push({ from: dir, to: dest });
  }

  const restored = [];
  for (const ext of snapshot.extensions || []) {
    const source = path.join(snapshot.path, ext.name);
    const dest = path.join(EXTENSIONS_DIR, ext.name);
    if (!fsSync.existsSync(source)) continue;
    await fs.cp(source, dest, { recursive: true, force: false, errorOnExist: true });
    restored.push(dest);
  }

  return { ok: true, restored, quarantined, snapshotPath: snapshot.path };
}

async function diskPreflight() {
  const out = await run("df", ["-Pk", VERSIONS_DIR]);
  if (!out.ok) return { ok: false, error: out.stderr };
  const lines = out.stdout.split("\n");
  const cols = lines.at(-1)?.trim().split(/\s+/) || [];
  const availableKb = Number(cols[3]);
  const ok = Number.isFinite(availableKb) && availableKb > 800_000;
  return { ok, availableKb, minAvailableKb: 800_000 };
}

async function networkPreflight(skip) {
  if (skip) return { ok: true, skipped: true };
  const out = await run("curl", ["-sSIL", "--max-time", "15", "-o", "/dev/null", "-w", "%{http_code}", DOWNLOADS_URL], { timeout: 20_000 });
  const httpCode = Number(out.stdout.trim());
  return {
    ok: out.ok && Number.isFinite(httpCode) && httpCode >= 200 && httpCode < 500,
    httpCode: Number.isFinite(httpCode) ? httpCode : null,
    stderr: out.stderr || null,
  };
}

async function codePreflight(skip) {
  if (skip) return { ok: true, skipped: true };
  const out = await run("code", ["--version"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  return {
    ok: out.ok,
    skipped: false,
    firstLine: out.stdout.split("\n")[0] || null,
    stderr: out.stderr || null,
  };
}

async function quarantineZeroByteVersionFiles(target, dryRun) {
  const entries = await fs.readdir(VERSIONS_DIR, { withFileTypes: true });
  const quarantined = [];
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^\d+\.\d+\.\d+$/.test(entry.name)) continue;
    if (/^\d+\.\d+\.\d+$/.test(target) && entry.name !== target) continue;
    const file = path.join(VERSIONS_DIR, entry.name);
    const stat = await fs.stat(file);
    if (stat.size !== 0) continue;
    const dest = `${file}.failed-${now}`;
    if (!dryRun) await fs.rename(file, dest);
    quarantined.push({ from: file, to: dest, dryRun });
  }
  return quarantined;
}

async function updateVsCodeExtension({ enabled, timeoutMs }) {
  if (!enabled) return { skipped: true, reason: "skip-extension" };
  const codeCheck = await run("code", ["--version"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  if (!codeCheck.ok) {
    return { ok: false, skipped: false, reason: "code-command-unavailable", codeCheck };
  }
  const install = await run("code", ["--force", "--install-extension", "anthropic.claude-code"], {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ok: install.ok, skipped: false, install };
}

async function restoreSymlink(previousState, snapshot) {
  const restoreTarget = previousState.info.realPath && fsSync.existsSync(previousState.info.realPath)
    ? previousState.info.realPath
    : snapshot.snapshot;
  if (!restoreTarget || !fsSync.existsSync(restoreTarget)) {
    return { ok: false, error: "no restore target exists", restoreTarget };
  }
  const binInfo = await pathInfo(CLAUDE_BIN);
  const quarantined = [];
  if (binInfo.exists) {
    if (binInfo.isSymlink) {
      await fs.rm(CLAUDE_BIN);
    } else {
      const dest = `${CLAUDE_BIN}.failed-safe-update-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
      await fs.rename(CLAUDE_BIN, dest);
      quarantined.push({ from: CLAUDE_BIN, to: dest });
    }
  }
  await fs.symlink(restoreTarget, CLAUDE_BIN);
  return { ok: true, restoreTarget, quarantined };
}

async function validatePostUpdate(previousVersion, options = {}) {
  const checks = [];
  const state = await currentClaudeState();
  const active = state.info.realPath || CLAUDE_BIN;
  const activeInfo = await pathInfo(active);
  checks.push({ name: "version", ok: state.versionOk && state.version !== "unknown", value: state.versionText });
  checks.push({ name: "binary-size", ok: activeInfo.size >= MIN_BINARY_BYTES, value: activeInfo.size });
  checks.push({ name: "binary-executable", ok: await executable(active), value: active });

  const health = await run("curl", ["-sS", HEALTH_URL]);
  let healthJson = null;
  try {
    healthJson = JSON.parse(health.stdout);
  } catch {}
  checks.push({ name: "proxy-health", ok: health.ok && healthJson?.ok === true, value: healthJson || health.stderr });

  const patchApply = await run("node", [PATCHER], { timeout: 60_000 });
  const patchLines = patchApply.stdout.split("\n").filter(Boolean);
  const patchPatternMissed = /pattern-missed|unsupported-|missing|error:/i.test(patchApply.stdout);
  checks.push({
    name: "patch-extension",
    ok: patchApply.ok && !patchPatternMissed,
    value: patchLines.slice(-8),
  });

  const doctor = await run("node", [DOCTOR], { timeout: 60_000 });
  let doctorJson = null;
  try {
    doctorJson = JSON.parse(doctor.stdout);
  } catch {}
  const patchStatuses = doctorJson?.vscode?.extensionPatches || [];
  const patchOk = patchStatuses.every((item) => {
    return String(item.webview || "").includes("already-patched")
      && String(item.host || "").includes("thinking-default-ok")
      && String(item.host || "").includes("max-thinking-ok");
  });
  const doctorOk = doctor.ok
    && doctorJson?.proxyHealth?.ok === true
    && doctorJson?.drift?.drift !== true
    && doctorJson?.vscode?.cliExtensionVersionMismatch !== true
    && patchOk;
  checks.push({ name: "doctor", ok: doctor.ok && doctorJson?.proxyHealth?.ok === true, value: {
    cliVersion: doctorJson?.cli?.version || null,
    proxyOk: doctorJson?.proxyHealth?.ok === true,
    drift: doctorJson?.drift?.drift ?? null,
    extensionMismatch: doctorJson?.vscode?.cliExtensionVersionMismatch ?? null,
    patchOk,
    safeUpdateStatus: doctorJson?.safeUpdate?.status || null,
  }});
  checks.at(-1).ok = doctorOk;

  let probeResult = { skipped: true, reason: "not-requested" };
  if (options.probe && !options.allowModelCall) {
    probeResult = { skipped: true, reason: "requires --allow-model-call to spend tokens" };
  } else if (options.probe && options.allowModelCall) {
    const out = await run(CLAUDE_BIN, [
      "-p",
      "--model",
      "haiku",
      "--max-budget-usd",
      String(options.probeBudgetUsd),
      "Safe-update probe. Reply exactly OK.",
    ], { timeout: 120_000 });
    const budgetBlocked = /Exceeded USD budget/i.test(`${out.stdout}\n${out.stderr}`);
    probeResult = {
      skipped: false,
      ok: out.ok,
      budgetUsd: options.probeBudgetUsd,
      nonCriticalFailure: !out.ok && budgetBlocked,
      stdout: out.stdout.slice(0, 200),
      stderr: out.stderr.slice(0, 500),
    };
    checks.push({ name: "model-probe", ok: out.ok || budgetBlocked, value: probeResult });
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    previousVersion,
    activeVersion: state.version,
    activeBinary: active,
    checks,
    probe: probeResult,
    doctorSummary: checks.find((check) => check.name === "doctor")?.value || null,
  };
}

async function writeBreadcrumb({ previousState, snapshot, extensionSnapshot, extensionUpdate, validation, target }) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(LAST_SAFE_UPDATE, JSON.stringify({
    timestamp: new Date().toISOString(),
    target,
    oldVersion: previousState.version,
    newVersion: validation.activeVersion,
    oldSymlinkTarget: previousState.info.linkTarget,
    newSymlinkTarget: (await pathInfo(CLAUDE_BIN)).linkTarget,
    snapshot: {
      path: snapshot.snapshot,
      sha256: snapshot.sha256,
      size: snapshot.size,
    },
    extensionSnapshot: extensionSnapshot ? {
      path: extensionSnapshot.path,
      count: extensionSnapshot.count,
      extensions: extensionSnapshot.extensions,
    } : null,
    extensionUpdate,
    validation,
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const previousState = await currentClaudeState();
  const previousExtensionState = await extensionState();
  const disk = await diskPreflight();
  const network = await networkPreflight(options.skipNetwork);
  const code = await codePreflight(!options.updateExtension);
  const snapshot = await createSnapshot(previousState, options.dryRun);
  const extensionSnapshot = await createExtensionSnapshot(previousExtensionState, options.dryRun);
  const quarantined = await quarantineZeroByteVersionFiles(options.target, options.dryRun);

  const preflight = {
    currentVersion: previousState.version,
    currentBinary: previousState.info.realPath,
    currentSymlinkTarget: previousState.info.linkTarget,
    extensions: previousExtensionState.extensions,
    disk,
    network,
    code,
    snapshot,
    extensionSnapshot,
    quarantined,
  };

  const preflightOk = previousState.versionOk
    && disk.ok
    && network.ok
    && code.ok
    && snapshot.size >= MIN_BINARY_BYTES;
  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: preflightOk,
      dryRun: true,
      target: options.target,
      updateExtension: options.updateExtension,
      probeBudgetUsd: options.probeBudgetUsd,
      preflight,
      next: "run without --dry-run to update",
    }, null, 2));
    process.exit(preflightOk ? 0 : 1);
  }
  if (!preflightOk) {
    console.error(JSON.stringify({ ok: false, phase: "preflight", target: options.target, preflight }, null, 2));
    process.exit(1);
  }

  const install = await run(CLAUDE_BIN, ["install", options.target], { timeout: options.timeoutMs });
  if (!install.ok) {
    const restored = await restoreSymlink(previousState, snapshot);
    console.error(JSON.stringify({ ok: false, phase: "install", target: options.target, install, restored, preflight }, null, 2));
    process.exit(1);
  }

  const extensionUpdate = await updateVsCodeExtension({
    enabled: options.updateExtension,
    timeoutMs: options.timeoutMs,
  });
  if (extensionUpdate.ok === false) {
    const restoredCli = await restoreSymlink(previousState, snapshot);
    const restoredExtensions = await restoreExtensionSnapshot(extensionSnapshot);
    console.error(JSON.stringify({
      ok: false,
      phase: "extension-install",
      target: options.target,
      extensionUpdate,
      restoredCli,
      restoredExtensions,
      preflight,
    }, null, 2));
    process.exit(1);
  }

  const validation = await validatePostUpdate(previousState.version, options);
  if (!validation.ok) {
    const restoredCli = await restoreSymlink(previousState, snapshot);
    const restoredExtensions = await restoreExtensionSnapshot(extensionSnapshot);
    console.error(JSON.stringify({
      ok: false,
      phase: "postflight",
      target: options.target,
      validation,
      restoredCli,
      restoredExtensions,
      extensionUpdate,
      preflight,
    }, null, 2));
    process.exit(1);
  }

  await writeBreadcrumb({ previousState, snapshot, extensionSnapshot, extensionUpdate, validation, target: options.target });
  console.log(JSON.stringify({ ok: true, target: options.target, preflight, extensionUpdate, validation, breadcrumb: LAST_SAFE_UPDATE }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
