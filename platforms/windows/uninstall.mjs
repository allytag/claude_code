#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");

async function run(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 20_000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() || "", stderr: error.stderr?.trim() || error.message };
  }
}

const command = ["schtasks", ["/Delete", "/TN", "OpenRouterClaudeProxy", "/F"]];

console.log(JSON.stringify({
  status: "windows-beta",
  dryRun: !apply || dryRun,
  note: "Conservative uninstall only deletes the optional Task Scheduler task. It does not delete .claude, wrappers, settings, logs, or backups.",
  command: `${command[0]} ${command[1].join(" ")}`,
}, null, 2));

if (!apply || dryRun) process.exit(0);

const out = await run(command[0], command[1]);
if (!out.ok) {
  console.error(out.stderr);
  process.exitCode = 1;
}
