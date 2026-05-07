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
const LOG_DIR = "__HOME__/.claude/logs";
const LAST_SAFE_UPDATE = path.join(LOG_DIR, "last-safe-update.json");
const DOCTOR = "__HOME__/.claude/openrouter-claude-proxy/doctor.mjs";
const PATCHER = "__HOME__/.claude/openrouter-claude-proxy/patch-extension.mjs";
const HEALTH_URL = "http://127.0.0.1:4141/health";
const DOWNLOADS_URL = "https://downloads.claude.ai/claude-code-releases";
const MIN_BINARY_BYTES = 100_000_000;
const DEFAULT_TIMEOUT_MS = 300_000;

function usage() {
  return `Usage: claude-safe-update [target] [options]

Safely install/update Claude Code native build with rollback.

Targets:
  latest | stable | 2.x.y       Default: latest

Options:
  --dry-run                     Run preflight and print plan, no writes or update
  --skip-network                Skip download endpoint TLS preflight
  --timeout-ms <ms>             Installer timeout, default ${DEFAULT_TIMEOUT_MS}
  --probe                       Optional tiny post-update model probe, skipped unless --allow-model-call also set
  --allow-model-call            Allow --probe to spend OpenRouter tokens
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
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-network") {
      options.skipNetwork = true;
    } else if (arg === "--probe") {
      options.probe = true;
    } else if (arg === "--allow-model-call") {
      options.allowModelCall = true;
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

async function validatePostUpdate(previousVersion, probe, allowModelCall) {
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

  const patch = await run("node", [PATCHER, "--dry-run"]);
  checks.push({ name: "patch-dry-run", ok: patch.ok, value: patch.stdout.split("\n").filter(Boolean).slice(-5) });

  const doctor = await run("node", [DOCTOR], { timeout: 60_000 });
  let doctorJson = null;
  try {
    doctorJson = JSON.parse(doctor.stdout);
  } catch {}
  checks.push({ name: "doctor", ok: doctor.ok && doctorJson?.proxyHealth?.ok === true, value: {
    cliVersion: doctorJson?.cli?.version || null,
    proxyOk: doctorJson?.proxyHealth?.ok === true,
    drift: doctorJson?.drift?.drift ?? null,
    extensionMismatch: doctorJson?.vscode?.cliExtensionVersionMismatch ?? null,
  }});

  let probeResult = { skipped: true, reason: "not-requested" };
  if (probe && !allowModelCall) {
    probeResult = { skipped: true, reason: "requires --allow-model-call to spend tokens" };
  } else if (probe && allowModelCall) {
    const out = await run(CLAUDE_BIN, [
      "-p",
      "--model",
      "haiku",
      "--max-budget-usd",
      "0.01",
      "Safe-update probe. Reply exactly OK.",
    ], { timeout: 120_000 });
    probeResult = { skipped: false, ok: out.ok, stdout: out.stdout.slice(0, 200), stderr: out.stderr.slice(0, 500) };
    checks.push({ name: "model-probe", ok: out.ok, value: probeResult });
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

async function writeBreadcrumb({ previousState, snapshot, validation, target }) {
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
  const disk = await diskPreflight();
  const network = await networkPreflight(options.skipNetwork);
  const snapshot = await createSnapshot(previousState, options.dryRun);
  const quarantined = await quarantineZeroByteVersionFiles(options.target, options.dryRun);

  const preflight = {
    currentVersion: previousState.version,
    currentBinary: previousState.info.realPath,
    currentSymlinkTarget: previousState.info.linkTarget,
    disk,
    network,
    snapshot,
    quarantined,
  };

  const preflightOk = previousState.versionOk && disk.ok && network.ok && snapshot.size >= MIN_BINARY_BYTES;
  if (options.dryRun) {
    console.log(JSON.stringify({ ok: preflightOk, dryRun: true, target: options.target, preflight, next: "run without --dry-run to update" }, null, 2));
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

  const validation = await validatePostUpdate(previousState.version, options.probe, options.allowModelCall);
  if (!validation.ok) {
    const restored = await restoreSymlink(previousState, snapshot);
    console.error(JSON.stringify({ ok: false, phase: "postflight", target: options.target, validation, restored, preflight }, null, 2));
    process.exit(1);
  }

  await writeBreadcrumb({ previousState, snapshot, validation, target: options.target });
  console.log(JSON.stringify({ ok: true, target: options.target, preflight, validation, breadcrumb: LAST_SAFE_UPDATE }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
