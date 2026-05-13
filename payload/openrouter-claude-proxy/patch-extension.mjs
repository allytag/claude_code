import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOME = "__HOME__";
const EXTENSIONS_DIR = path.join(HOME, ".vscode", "extensions");
const EXTENSION_PREFIX = "anthropic.claude-code-";
const BACKUP_SUFFIX = ".codex-openrouter-backup";

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readText(file) {
  return fs.readFile(file, "utf8");
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

async function backupOnce(file) {
  const backup = `${file}${BACKUP_SUFFIX}`;
  if (await exists(backup)) return backup;
  await fs.copyFile(file, backup);
  return backup;
}

async function writeIfChanged(file, before, after, { dryRun = false } = {}) {
  if (before === after) return { changed: false, backup: `${file}${BACKUP_SUFFIX}` };
  if (dryRun) return { changed: true, backup: `${file}${BACKUP_SUFFIX}`, dryRun: true };
  const backup = await backupOnce(file);
  await fs.writeFile(file, after);
  return { changed: true, backup };
}

function patchError(file, error) {
  const code = error?.code ? `${error.code}: ` : "";
  return { file, status: `error:${code}${error.message || String(error)}` };
}

async function patchWebview(extensionDir, options = {}) {
  const file = path.join(extensionDir, "webview", "index.js");
  if (!(await exists(file))) return { file, status: "missing" };

  const before = await readText(file);
  if (before.includes('$.content.type==="redacted_thinking"')) {
    return { file, status: "already-patched" };
  }

  const marker = '"Unsupported content type: "';
  const markerIndex = before.indexOf(marker);
  if (markerIndex === -1) return { file, status: "unsupported-marker-missing" };

  const returnIndex = before.lastIndexOf("return ", markerIndex);
  if (returnIndex === -1) return { file, status: "unsupported-return-missing" };

  const insertion = 'if($.content.type==="redacted_thinking")return null;';
  const after = `${before.slice(0, returnIndex)}${insertion}${before.slice(returnIndex)}`;
  const result = await writeIfChanged(file, before, after, options);
  return { file, status: result.changed ? (options.dryRun ? "would-patch" : "patched") : "unchanged", backup: result.backup };
}

async function patchExtensionHost(extensionDir, options = {}) {
  const file = path.join(extensionDir, "extension.js");
  if (!(await exists(file))) return { file, status: "missing" };

  let after = await readText(file);
  const before = after;
  const changes = [];

  const thinkingDefaultPattern = /getThinkingLevel\(\)\{let ([A-Za-z_$][\w$]*)=this\.context\.globalState\.get\("thinkingLevel"\);return \1\?\1:"default_on"\}/;
  if (thinkingDefaultPattern.test(after)) {
    after = after.replace(
      thinkingDefaultPattern,
      'getThinkingLevel(){let $1=this.context.globalState.get("thinkingLevel");return "off"}',
    );
    changes.push("thinking-default-off");
  } else if (after.includes("getThinkingLevel(){") && after.includes('"default_on"')) {
    changes.push("thinking-default-pattern-missed");
  } else {
    changes.push("thinking-default-ok");
  }

  const maxThinkingPattern = /getMaxThinkingTokensForModel\(([A-Za-z_$][\w$]*)\)\{if\(\1==="off"\)return 0;return \d+\}/;
  if (maxThinkingPattern.test(after)) {
    after = after.replace(maxThinkingPattern, "getMaxThinkingTokensForModel($1){return 0}");
    changes.push("max-thinking-zero");
  } else if (/getMaxThinkingTokensForModel\([A-Za-z_$][\w$]*\)\{return 0\}/.test(after)) {
    changes.push("max-thinking-ok");
  } else {
    changes.push("max-thinking-pattern-missed");
  }

  const result = await writeIfChanged(file, before, after, options);
  const prefix = result.changed ? (options.dryRun ? "would-patch" : "patched") : "already-patched";
  return { file, status: `${prefix}:${changes.join(",")}`, backup: result.backup };
}

async function patchPackageJson(extensionDir, options = {}) {
  const file = path.join(extensionDir, "package.json");
  if (!(await exists(file))) return { file, status: "missing" };

  const before = await readText(file);
  const pkg = JSON.parse(before);
  const changes = [];

  for (const command of pkg.contributes?.commands || []) {
    if (command.command === "claude-vscode.update" && command.enablement !== "false") {
      command.enablement = "false";
      changes.push("update-command-disabled");
    }
  }

  for (const menu of pkg.contributes?.menus?.commandPalette || []) {
    if (menu.command === "claude-vscode.update" && menu.when !== "false") {
      menu.when = "false";
      changes.push("update-menu-hidden");
    }
  }

  const after = `${JSON.stringify(pkg, null, 2)}\n`;
  const result = await writeIfChanged(file, before, after, options);
  const prefix = result.changed ? (options.dryRun ? "would-patch" : "patched") : "already-patched";
  const detail = changes.length > 0 ? changes.join(",") : "update-command-hidden";
  return { file, status: `${prefix}:${detail}`, backup: result.backup };
}

async function extensionInfo(dir) {
  const packageFile = path.join(dir, "package.json");
  let version = "unknown";
  try {
    version = (await readJson(packageFile)).version || version;
  } catch {
    // Keep unknown.
  }
  return { dir, name: path.basename(dir), version };
}

async function findExtensionDirs() {
  const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_PREFIX))
    .map((entry) => path.join(EXTENSIONS_DIR, entry.name))
    .sort();
}

async function rollbackExtension(extensionDir) {
  const files = [
    path.join(extensionDir, "package.json"),
    path.join(extensionDir, "extension.js"),
    path.join(extensionDir, "webview", "index.js"),
  ];
  const restored = [];
  const missing = [];

  for (const file of files) {
    const backup = `${file}${BACKUP_SUFFIX}`;
    if (!(await exists(backup))) {
      missing.push(backup);
      continue;
    }
    await fs.copyFile(backup, file);
    restored.push(file);
  }

  return { restored, missing };
}

export async function patchAllExtensions({ log = () => {}, dryRun = false } = {}) {
  const dirs = await findExtensionDirs();
  const results = [];

  for (const dir of dirs) {
    const info = await extensionInfo(dir);
    const webviewFile = path.join(dir, "webview", "index.js");
    const hostFile = path.join(dir, "extension.js");
    const packageFile = path.join(dir, "package.json");
    let webview;
    let host;
    let packageJson;
    try {
      webview = await patchWebview(dir, { dryRun });
    } catch (error) {
      webview = patchError(webviewFile, error);
    }
    try {
      host = await patchExtensionHost(dir, { dryRun });
    } catch (error) {
      host = patchError(hostFile, error);
    }
    try {
      packageJson = await patchPackageJson(dir, { dryRun });
    } catch (error) {
      packageJson = patchError(packageFile, error);
    }
    const result = { ...info, webview, host, packageJson };
    results.push(result);
    log(`[patch-extension] ${info.name} version=${info.version} webview=${webview.status} host=${host.status} package=${packageJson.status}`);
    const webviewBad = webview.status.includes("missing") || webview.status.includes("unsupported") || webview.status.startsWith("error:");
    const hostBad = host.status.includes("pattern-missed") || host.status.includes("missing") || host.status.startsWith("error:");
    const packageBad = packageJson.status.includes("missing") || packageJson.status.startsWith("error:");
    if (webviewBad || hostBad || packageBad) {
      log(`[patch-extension] WARNING ${info.name} partial patch status: webview=${webview.status} host=${host.status} package=${packageJson.status} — review patch-extension.mjs against new extension version`);
    }
  }

  if (dirs.length === 0) {
    log("[patch-extension] no Claude Code VS Code extension found in __HOME__/.vscode/extensions");
  }
  return results;
}

export async function rollbackAllExtensions({ log = () => {} } = {}) {
  const dirs = await findExtensionDirs();
  const results = [];

  for (const dir of dirs) {
    const info = await extensionInfo(dir);
    const rollback = await rollbackExtension(dir);
    const result = { ...info, rollback };
    results.push(result);
    log(`[rollback-extension] ${info.name} version=${info.version} restored=${rollback.restored.length} missing=${rollback.missing.length}`);
  }

  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rollback = process.argv.includes("--rollback");
  const dryRun = process.argv.includes("--dry-run");
  const fn = rollback ? rollbackAllExtensions : patchAllExtensions;
  fn({ log: console.log, dryRun }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
