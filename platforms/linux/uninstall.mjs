#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 20_000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() || "", stderr: error.stderr?.trim() || error.message };
  }
}

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");

const commands = [
  ["systemctl", ["--user", "disable", "--now", "openrouter-claude-proxy.service"]],
  ["systemctl", ["--user", "daemon-reload"]],
];

console.log(JSON.stringify({
  status: "linux-beta",
  dryRun: !apply || dryRun,
  note: "Conservative uninstall only stops/disables the user service. It does not delete ~/.claude, wrappers, settings, logs, or backups.",
  commands: commands.map(([command, args]) => `${command} ${args.join(" ")}`),
}, null, 2));

if (!apply || dryRun) process.exit(0);

for (const [command, args] of commands) {
  const out = await run(command, args);
  if (!out.ok) console.error(`${command}: ${out.stderr}`);
}
