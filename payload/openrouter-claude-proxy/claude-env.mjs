#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";

const SETTINGS = "__HOME__/.claude/settings.json";
const ORIGINAL_CLAUDE = process.env.CLAUDE_ORIGINAL_BIN || "__HOME__/.local/bin/claude";

function shouldForwardSettingEnv(key) {
  return (
    key.startsWith("ANTHROPIC_") ||
    key.startsWith("CLAUDE_CODE_") ||
    key === "DISABLE_TELEMETRY" ||
    key === "DISABLE_AUTOUPDATER" ||
    key === "ENABLE_PROMPT_CACHING_1H" ||
    key === "FORCE_PROMPT_CACHING_5M" ||
    key === "API_TIMEOUT_MS"
  );
}

function filteredSettingEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!shouldForwardSettingEnv(key)) continue;
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function loadClaudeCodeEnv() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const env = settings.env || {};
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!token) {
    throw new Error("ANTHROPIC_AUTH_TOKEN missing in __HOME__/.claude/settings.json");
  }
  return {
    ...filteredSettingEnv(env),
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || "http://127.0.0.1:4141",
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: "",
    DISABLE_TELEMETRY: env.DISABLE_TELEMETRY || "1",
  };
}

let injected;
try {
  injected = loadClaudeCodeEnv();
} catch (error) {
  console.error(`claude-env error: ${error.message}`);
  process.exit(1);
}

const child = spawn(ORIGINAL_CLAUDE, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    ...injected,
  },
});

child.on("error", (error) => {
  console.error(`claude-env error: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
