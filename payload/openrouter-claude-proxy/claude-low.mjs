#!/usr/bin/env node
import fs from "node:fs";

const SETTINGS = "__HOME__/.claude/settings.json";
const REGISTRY = "__HOME__/.claude/openrouter-claude-proxy/model-registry.json";
const DEFAULT_MAX_TOKENS = 1024;

const SHORT_ALIASES = {
  qwen: "qwen3.6-plus",
  kimi: "kimi-k2.6",
  deepseek: "deepseek-v4-pro",
  glm: "glm-5.1",
};

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  } catch {
    return null;
  }
}

function resolveModel(value) {
  const candidate = SHORT_ALIASES[value] || value;
  const registry = loadRegistry();
  if (!registry) return candidate;
  const roleAlias = registry.roles?.[candidate];
  if (roleAlias && registry.models?.[roleAlias]?.id) return registry.models[roleAlias].id;
  if (registry.models?.[candidate]?.id) return registry.models[candidate].id;
  const byId = Object.values(registry.models || {}).find((model) => model.id === candidate);
  return byId?.id || candidate;
}

function usage() {
  console.error(`Usage:
  claude-low "question"
  claude-low --model qwen "question"
  claude-low --model kimi "question"
  echo "question" | claude-low

Low-token mode has no Claude Code tools. Use normal claude for file edits, bash, repo inspection, tests, MCP, or project work.`);
}

function parseArgs(argv) {
  const args = [...argv];
  let model = process.env.OPENROUTER_LOW_MODEL || "lowToken";
  let maxTokens = DEFAULT_MAX_TOKENS;
  const promptParts = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--model") {
      const value = args.shift();
      if (!value) throw new Error("--model needs value");
      model = resolveModel(value);
      continue;
    }
    if (arg === "--max-tokens") {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) throw new Error("--max-tokens needs positive number");
      maxTokens = Math.min(value, 4096);
      continue;
    }
    promptParts.push(arg);
  }

  return { model: resolveModel(model), maxTokens, prompt: promptParts.join(" ").trim() };
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  return fs.readFileSync(0, "utf8").trim();
}

function loadSettings() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const token = settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!token) throw new Error("ANTHROPIC_AUTH_TOKEN missing in ~/.claude/settings.json");
  return {
    token,
    baseUrl: settings.env?.ANTHROPIC_BASE_URL || "http://127.0.0.1:4141",
  };
}

function extractText(body) {
  const content = body?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text")
      .map((part) => part.text || "")
      .join("");
  }
  return "";
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  usage();
  process.exit(0);
}

const prompt = parsed.prompt || readStdin();
if (!prompt) {
  usage();
  process.exit(2);
}

const settings = loadSettings();
const url = `${settings.baseUrl.replace(/\/+$/, "")}/v1/messages`;
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${settings.token}`,
    "anthropic-version": "2023-06-01",
    "x-cc-openrouter-source": "claude-low",
    "x-cc-openrouter-mode": "low-token",
  },
  body: JSON.stringify({
    model: parsed.model,
    max_tokens: parsed.maxTokens,
    system: "Low-token mode. Concise coding assistant. No local tools. If task needs files, terminal, repo inspection, edits, tests, MCP, or project state, tell user to use full Claude Code mode.",
    messages: [{ role: "user", content: prompt }],
  }),
});

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = null;
}

if (!response.ok) {
  const message = body?.error?.message || text || response.statusText;
  throw new Error(`OpenRouter low-token request failed (${response.status}): ${message}`);
}

const output = Array.isArray(body?.content)
  ? body.content.map(extractText).join("")
  : extractText(body);

process.stdout.write(output || "");
if (!output.endsWith("\n")) process.stdout.write("\n");
