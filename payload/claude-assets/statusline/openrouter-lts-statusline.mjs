#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const HOME = "__HOME__";
const METRICS = path.join(HOME, ".claude", "logs", "openrouter-claude-proxy-last-metrics.json");
const SETTINGS = path.join(HOME, ".claude", "settings.json");
const REGISTRY = path.join(HOME, ".claude", "openrouter-claude-proxy", "model-registry.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function money(value) {
  return typeof value === "number" ? `$${value.toFixed(value < 0.01 ? 5 : 3)}` : "$?";
}

function compactTokens(value) {
  if (typeof value !== "number") return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function roleForModel(registry, modelId) {
  if (!registry || !modelId) return null;
  for (const [role, alias] of Object.entries(registry.roles || {})) {
    const id = registry.models?.[alias]?.id;
    if (id && (modelId === id || modelId.startsWith(`${id}-`) || id.startsWith(modelId))) return role;
  }
  return null;
}

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const status = input ? readInlineJson(input) : {};
  const settings = readJson(SETTINGS);
  const registry = readJson(REGISTRY);
  const metrics = readJson(METRICS);
  const modelId = metrics?.selectedModel || status?.model?.id || settings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || "unknown";
  const role = roleForModel(registry, modelId) || settings?.model || "model";
  const provider = metrics?.provider ? ` ${metrics.provider}` : "";
  const cost = money(metrics?.costUsd);
  const tokens = `in ${compactTokens(metrics?.inputTokens)} out ${compactTokens(metrics?.outputTokens)}`;
  const cache = metrics?.cacheReadTokens ? ` cache ${compactTokens(metrics.cacheReadTokens)}` : "";
  const finish = metrics?.finishReason ? ` finish ${metrics.finishReason}` : "";
  const retry = metrics?.retryCount ? ` retry ${metrics.retryCount}` : "";
  const advice = Array.isArray(metrics?.contextAdvice) && metrics.contextAdvice.length ? " compact soon" : "";
  const cwd = path.basename(status?.workspace?.current_dir || status?.cwd || "");
  const dir = cwd ? ` ${cwd}` : "";
  console.log(`OpenRouter LTS | ${role}:${modelId}${provider} | ${cost} | ${tokens}${cache}${finish}${retry}${advice}${dir}`.slice(0, 220));
});

function readInlineJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
