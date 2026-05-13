#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const HOME = "__HOME__";
const SKILLS_DIR = path.join(HOME, ".claude", "skills");
const INBOX_DIR = path.join(HOME, ".claude", "skill-inbox");
const BACKUP_DIR = path.join(HOME, ".claude", "skill-backups");

const ALLOWED_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "TodoRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]);

const FAIL_PATTERNS = [
  { pattern: /sk-or-[A-Za-z0-9_-]+/i, reason: "OpenRouter secret-like token" },
  { pattern: /sk-ant-[A-Za-z0-9_-]+/i, reason: "Anthropic secret-like token" },
  { pattern: /sk-proj-[A-Za-z0-9_-]+/i, reason: "OpenAI secret-like token" },
  { pattern: /\/Users\/apple\/(?!\.claude\/skill-inbox)/, reason: "private absolute user path" },
  { pattern: /\bignore (all )?(previous|above|system|developer) instructions\b/i, reason: "prompt-injection phrase" },
  { pattern: /\balways (override|bypass|ignore)\b/i, reason: "unsafe override instruction" },
  { pattern: /\brm\s+-rf\s+(\/|\$HOME|~|\*)/i, reason: "destructive delete command" },
  { pattern: /\bsudo\b/i, reason: "privilege escalation" },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "unsafe permission change" },
  { pattern: /\bdiskutil\s+erase/i, reason: "disk erase command" },
  { pattern: /\bdd\s+if=/i, reason: "raw disk write command" },
  { pattern: /\bmkfs\b/i, reason: "filesystem format command" },
  { pattern: /curl\b[^|\n]*\|\s*(sh|bash|zsh)/i, reason: "remote shell pipe" },
];

const WARN_PATTERNS = [
  { pattern: /\bevery (request|prompt|task|turn)\b/i, reason: "may become too broad" },
  { pattern: /\balways use\b/i, reason: "trigger may be too broad" },
];

function usage() {
  return `Usage:
  node skill-guard.mjs status
  node skill-guard.mjs validate <candidate-dir-or-SKILL.md>
  node skill-guard.mjs promote <candidate-dir-or-SKILL.md> [--apply]

Default is dry-run. promote writes only with --apply after validation passes.`;
}

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

function skillPath(input) {
  if (!input) return null;
  if (input.endsWith(".md")) return input;
  return path.join(input, "SKILL.md");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text, ok: false, error: "missing frontmatter" };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text, ok: false, error: "unterminated frontmatter" };
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4);
  const data = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body, ok: true };
}

function parseAllowedTools(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function validate(input) {
  const file = skillPath(path.resolve(input || ""));
  const errors = [];
  const warnings = [];
  if (!file || !(await exists(file))) {
    return { ok: false, file, errors: ["SKILL.md not found"], warnings };
  }

  const text = await readText(file);
  const bytes = Buffer.byteLength(text);
  if (bytes > 12_000) errors.push(`skill too large (${bytes} bytes > 12000)`);
  if (bytes < 200) warnings.push("skill is very small; may lack useful workflow detail");

  const fm = parseFrontmatter(text);
  if (!fm.ok) errors.push(fm.error);
  const name = fm.data.name || "";
  const description = fm.data.description || "";
  const skillId = slug(path.basename(path.dirname(file)) === "." ? name : path.basename(path.dirname(file)));

  if (!name) errors.push("frontmatter name missing");
  if (!description) errors.push("frontmatter description missing");
  if (description && description.length < 40) warnings.push("description may be too short for reliable auto-triggering");
  if (description.length > 700) warnings.push("description is long; may add unnecessary trigger text");
  if (!skillId) errors.push("cannot derive skill id");

  const tools = parseAllowedTools(fm.data["allowed-tools"]);
  if (tools.length === 0) errors.push("allowed-tools missing");
  const unknownTools = tools.filter((tool) => !ALLOWED_TOOLS.has(tool));
  if (unknownTools.length) errors.push(`unknown allowed-tools: ${unknownTools.join(", ")}`);
  if (tools.includes("Write") && !/draft|new file|generate|create/i.test(text)) {
    warnings.push("Write tool present without clear creation/drafting reason");
  }
  if (tools.includes("Bash") && !/safe|scoped|targeted|verify|guard|read-only|avoid destructive/i.test(text)) {
    warnings.push("Bash tool present without clear scoped/safe-use guidance");
  }
  if ((tools.includes("Edit") || tools.includes("MultiEdit")) && !/verify|test|review|read before edit/i.test(text)) {
    warnings.push("edit tools present without explicit verification/read-before-edit discipline");
  }

  for (const item of FAIL_PATTERNS) {
    if (item.pattern.test(text)) errors.push(item.reason);
  }
  for (const item of WARN_PATTERNS) {
    if (item.pattern.test(text)) warnings.push(item.reason);
  }

  const targetDir = path.join(SKILLS_DIR, skillId);
  const installed = await exists(path.join(targetDir, "SKILL.md"));
  if (installed) warnings.push(`existing skill will be updated with backup: ${skillId}`);

  return {
    ok: errors.length === 0,
    file,
    skillId,
    name,
    descriptionLength: description.length,
    bytes,
    tools,
    targetDir,
    installed,
    errors,
    warnings: [...new Set(warnings)],
  };
}

async function status() {
  const candidates = [];
  const entries = await fs.readdir(INBOX_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = entry.isDirectory() ? path.join(INBOX_DIR, entry.name) : path.join(INBOX_DIR, entry.name);
    if (entry.isDirectory() || entry.name.endsWith(".md")) candidates.push(await validate(candidate));
  }
  const installed = await fs.readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
  return {
    ok: true,
    inbox: INBOX_DIR,
    installedSkillCount: installed.filter((entry) => entry.isDirectory()).length,
    candidateCount: candidates.length,
    candidates,
  };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function promote(input, apply) {
  const result = await validate(input);
  if (!result.ok) return { ok: false, dryRun: !apply, validation: result, action: "blocked" };
  const backupRoot = path.join(BACKUP_DIR, `${result.skillId}-${stamp()}`);
  const targetFile = path.join(result.targetDir, "SKILL.md");
  const plan = [];
  if (result.installed) plan.push({ action: "backup", from: targetFile, to: path.join(backupRoot, "SKILL.md") });
  plan.push({ action: "write", from: result.file, to: targetFile });

  if (!apply) return { ok: true, dryRun: true, validation: result, plan, next: "rerun with --apply to promote" };

  if (result.installed) {
    await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await fs.copyFile(targetFile, path.join(backupRoot, "SKILL.md"));
  }
  await fs.mkdir(result.targetDir, { recursive: true });
  await fs.copyFile(result.file, targetFile);
  await fs.chmod(targetFile, 0o644);
  return { ok: true, dryRun: false, validation: result, backup: result.installed ? backupRoot : null, promoted: targetFile };
}

const [cmd, input, ...rest] = process.argv.slice(2);
let out;
if (!cmd || cmd === "-h" || cmd === "--help") {
  console.log(usage());
  process.exit(0);
} else if (cmd === "status") {
  out = await status();
} else if (cmd === "validate") {
  out = await validate(input);
} else if (cmd === "promote") {
  out = await promote(input, rest.includes("--apply"));
} else {
  console.error(JSON.stringify({ ok: false, error: `unknown command: ${cmd}`, usage: usage() }, null, 2));
  process.exit(2);
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 2);
