import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { patchAllExtensions } from "./patch-extension.mjs";

const PORT = Number(process.env.PORT || process.env.CLAUDE_OPENROUTER_PROXY_PORT || 4141);
const UPSTREAM = (process.env.OPENROUTER_ANTHROPIC_BASE_URL || "https://openrouter.ai/api").replace(/\/+$/, "");
const HIDDEN_CONTENT_TYPES = new Set(["thinking", "redacted_thinking"]);
const THINKING_FIELD_NAMES = new Set(["thinking", "thinking_config", "extended_thinking", "reasoning"]);
const PATCH_INTERVAL_MS = 60_000;
const LOG_DIR = "__HOME__/.claude/logs";
const METRICS_LOG = `${LOG_DIR}/openrouter-claude-proxy-metrics.jsonl`;
const LAST_METRICS = `${LOG_DIR}/openrouter-claude-proxy-last-metrics.json`;

const DEBUG_TOKENS = flag("OPENROUTER_PROXY_DEBUG_TOKENS", false);
const STRICT_BUDGET = flag("OPENROUTER_PROXY_BUDGET_STRICT", false);
const RESPONSE_CACHE = flag("OPENROUTER_PROXY_RESPONSE_CACHE", false);
const PROMPT_CACHE = process.env.OPENROUTER_PROXY_PROMPT_CACHE || "off";
const PIN_PROVIDER = flag("OPENROUTER_PROXY_PIN_PROVIDER", false);
const REMAP_INTERNAL_HAIKU_ENV = optionalFlag("OPENROUTER_PROXY_REMAP_INTERNAL_HAIKU");
const REGISTRY_PATH = process.env.OPENROUTER_PROXY_REGISTRY_PATH || "__HOME__/.claude/openrouter-claude-proxy/model-registry.json";
const WARN_CONTEXT_TOKENS = Number(process.env.OPENROUTER_PROXY_WARN_CONTEXT_TOKENS || 50_000);
const WARN_COST_USD = Number(process.env.OPENROUTER_PROXY_WARN_COST_USD || 0.02);
const LOW_TOKEN_MAX_ESTIMATED_TOKENS = Number(process.env.OPENROUTER_PROXY_LOW_TOKEN_MAX_ESTIMATED_TOKENS || 10_000);
const RETRY_TRANSIENT = flag("OPENROUTER_PROXY_RETRY_TRANSIENT", true);
const MAX_RETRIES = Math.max(0, Number(process.env.OPENROUTER_PROXY_MAX_RETRIES || 1));
const RETRY_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function flag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function optionalFlag(name) {
  const raw = process.env[name];
  if (raw === undefined) return null;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

let REGISTRY_CACHE = null;
let REGISTRY_LOADED_AT = 0;
function loadRegistry() {
  const now = Date.now();
  if (REGISTRY_CACHE && now - REGISTRY_LOADED_AT < 30_000) return REGISTRY_CACHE;
  try {
    REGISTRY_CACHE = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    REGISTRY_LOADED_AT = now;
  } catch {
    REGISTRY_CACHE = null;
  }
  return REGISTRY_CACHE;
}

function findRegistryEntry(modelId) {
  const reg = loadRegistry();
  if (!reg) return null;
  const found = Object.values(reg.models || {}).find((entry) => {
    const id = entry?.id || "";
    return id === modelId || modelId.startsWith(`${id}-`) || id === modelId.replace(/-\d{8,}.*$/, "");
  });
  return found || null;
}

function globToRegex(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function modelMatchesAny(model, patterns) {
  const value = String(model || "");
  return patterns.some((pattern) => globToRegex(pattern).test(value));
}

function isHaikuLikeModel(model) {
  return /claude.*haiku|haiku.*claude/i.test(String(model || ""));
}

function registryModelForRole(registry, role) {
  const alias = registry?.roles?.[role];
  return alias ? registry?.models?.[alias] || null : null;
}

function internalHaikuRemapConfig() {
  const registry = loadRegistry();
  const config = registry?.remaps?.internalHaiku || {};
  const safety = config.safety || {};
  return {
    enabled: REMAP_INTERNAL_HAIKU_ENV ?? (config.enabled !== false),
    targetRole: config.targetRole || "cheapFull",
    sourceModelPatterns: config.sourceModelPatterns || [
      "claude-haiku-*",
      "claude-*-haiku*",
      "anthropic/claude-haiku-*",
      "anthropic/claude-*-haiku*",
    ],
    safety: {
      requireClaudeCliSource: safety.requireClaudeCliSource !== false,
      maxMessages: Number(safety.maxMessages ?? 2),
      maxSystemChars: Number(safety.maxSystemChars ?? 2_000),
      maxToolCount: Number(safety.maxToolCount ?? 0),
      maxToolSchemaBytes: Number(safety.maxToolSchemaBytes ?? 16),
      maxRequestBodyBytes: Number(safety.maxRequestBodyBytes ?? 4_096),
    },
    registry,
  };
}

function applyInternalHaikuRemapIfSafe(body, metrics) {
  const config = internalHaikuRemapConfig();
  const from = typeof body?.model === "string" ? body.model : null;
  metrics.modelRemap = {
    enabled: config.enabled,
    applied: false,
    type: "internal-haiku",
    from,
    to: null,
    targetRole: config.targetRole,
    reason: "not-evaluated",
  };

  if (!config.enabled) {
    metrics.modelRemap.reason = "disabled";
    return;
  }
  if (!body || typeof body !== "object" || !from) {
    metrics.modelRemap.reason = "non-object-or-missing-model";
    return;
  }
  if (!modelMatchesAny(from, config.sourceModelPatterns)) {
    metrics.modelRemap.reason = "model-not-matched";
    if (isHaikuLikeModel(from)) {
      metrics.modelRemap.warning = "haiku-like-model-not-remapped-check-sourceModelPatterns";
    }
    return;
  }

  const source = String(metrics.source || "").toLowerCase();
  if (config.safety.requireClaudeCliSource && !source.includes("claude-cli")) {
    metrics.modelRemap.reason = "source-not-claude-cli";
    return;
  }
  if (metrics.messageCount > config.safety.maxMessages) {
    metrics.modelRemap.reason = "too-many-messages";
    return;
  }
  if (metrics.systemChars > config.safety.maxSystemChars) {
    metrics.modelRemap.reason = "system-too-large";
    return;
  }
  if (metrics.toolCount > config.safety.maxToolCount || metrics.toolSchemaBytes > config.safety.maxToolSchemaBytes) {
    metrics.modelRemap.reason = "tools-present";
    return;
  }
  if (metrics.requestBodyBytes > config.safety.maxRequestBodyBytes) {
    metrics.modelRemap.reason = "body-too-large";
    return;
  }

  const target = registryModelForRole(config.registry, config.targetRole);
  if (!target?.id) {
    metrics.modelRemap.reason = "target-role-missing";
    return;
  }

  body.model = target.id;
  metrics.originalSelectedModel = from;
  metrics.modelRemap.applied = true;
  metrics.modelRemap.to = target.id;
  metrics.modelRemap.reason = "small-internal-haiku-background-request";
}

async function patchExtensions() {
  try {
    await patchAllExtensions({ log });
  } catch (error) {
    log(`[patch-extension] failed: ${error.message}`);
  }
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeJsonParse(buffer) {
  if (!buffer?.length) return null;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? ""));
}

function contentChars(value) {
  if (!value) return 0;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + contentChars(item), 0);
  if (typeof value === "object") return contentChars(value.text ?? value.content ?? "");
  return 0;
}

function describeBody(body, rawBytes) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const systemChars =
    contentChars(body?.system) +
    messages.filter((message) => message?.role === "system").reduce((sum, message) => sum + contentChars(message.content), 0);

  return {
    selectedModel: typeof body?.model === "string" ? body.model : null,
    requestBodyBytes: rawBytes,
    estimatedInputTokens: Math.ceil(rawBytes / 4),
    messageCount: messages.length,
    systemChars,
    toolCount: tools.length,
    toolSchemaBytes: byteLength(tools),
  };
}

function effortValue(body) {
  const candidates = [
    body?.effort,
    body?.metadata?.effort,
    body?.extra_body?.effort,
    body?.thinking?.effort,
    body?.reasoning?.effort,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.length > 0);
  return found ? found.toLowerCase() : null;
}

function explicitThinkingRequested(body) {
  return (
    body?.thinking?.type === "enabled" ||
    body?.thinking?.enabled === true ||
    body?.reasoning?.enabled === true ||
    body?.extra_body?.thinking?.type === "enabled" ||
    body?.extra_body?.reasoning?.enabled === true
  );
}

function hasReasoningRequestFields(body) {
  if (!body || typeof body !== "object") return false;
  for (const field of THINKING_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(body, field)) return true;
  }
  if (body.extra_body && typeof body.extra_body === "object") {
    for (const field of THINKING_FIELD_NAMES) {
      if (Object.prototype.hasOwnProperty.call(body.extra_body, field)) return true;
    }
  }
  return false;
}

function reasoningPassThroughSupported(modelId) {
  const entry = findRegistryEntry(modelId || "");
  return entry?.compatibility?.reasoningPassThrough === true;
}

function reasoningPolicyForBody(body) {
  const model = typeof body?.model === "string" ? body.model : "";
  const effort = effortValue(body);
  const explicitThinking = explicitThinkingRequested(body);
  const fieldsPresent = hasReasoningRequestFields(body);
  const supported = reasoningPassThroughSupported(model);

  if (!fieldsPresent) {
    return {
      action: "none",
      reason: "no-reasoning-fields",
      model,
      effort,
      explicitThinking,
      supported,
    };
  }

  if (supported && (effort === "high" || explicitThinking)) {
    return {
      action: "pass",
      reason: effort === "high" ? "registry-allowlist-effort-high" : "registry-allowlist-explicit-thinking",
      model,
      effort,
      explicitThinking,
      supported,
    };
  }

  return {
    action: "strip",
    reason: supported ? "effort-not-high" : "model-not-reasoning-allowlisted",
    model,
    effort,
    explicitThinking,
    supported,
  };
}

function sanitizeRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { body, removed: false, removedFields: [], reasoningPolicy: { action: "none", reason: "non-object-body" } };
  }
  const removedFields = [];
  const reasoningPolicy = reasoningPolicyForBody(body);

  if (reasoningPolicy.action === "pass") {
    return { body, removed: false, removedFields, reasoningPolicy };
  }

  for (const field of THINKING_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      delete body[field];
      removedFields.push(field);
    }
  }

  if (body.extra_body && typeof body.extra_body === "object") {
    for (const field of THINKING_FIELD_NAMES) {
      if (Object.prototype.hasOwnProperty.call(body.extra_body, field)) {
        delete body.extra_body[field];
        removedFields.push(`extra_body.${field}`);
      }
    }
  }

  return { body, removed: removedFields.length > 0, removedFields, reasoningPolicy };
}

function hasInlineCacheControl(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasInlineCacheControl);
  if (typeof value !== "object") return false;
  if (value.cache_control) return true;
  return Object.values(value).some(hasInlineCacheControl);
}

function markLastBlockEphemeral(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const last = value[value.length - 1];
  if (!last || typeof last !== "object") return false;
  if (last.cache_control) return false;
  last.cache_control = { type: "ephemeral" };
  return true;
}

// Smart prompt-cache injection.
// Modes:
//   "off"        — never modify (default).
//   "anthropic"  — only inject for anthropic/* model IDs (legacy behavior).
//   "auto"       — for any model: if Claude Code already injected cache_control inline, do nothing;
//                  else add cache_control: ephemeral on the last system content block (and last user
//                  message if a tool contract is present) so Anthropic-format providers (incl. Moonshot)
//                  can hit prompt cache. Conservative: never alters tool_use/tool_result blocks.
function applyPromptCacheIfSafe(body, metrics) {
  metrics.promptCache = {
    mode: PROMPT_CACHE,
    applied: false,
    reason: "disabled",
    locations: [],
  };

  if (PROMPT_CACHE === "off") return;
  if (!body || typeof body !== "object") {
    metrics.promptCache.reason = "non-object-body";
    return;
  }

  const model = body.model || "";

  if (PROMPT_CACHE === "anthropic" || PROMPT_CACHE === "1" || PROMPT_CACHE === "true" || PROMPT_CACHE === "on") {
    if (!model.startsWith("anthropic/")) {
      metrics.promptCache.reason = "non-anthropic-model";
      return;
    }
  }

  // If Claude Code (or any upstream tool) has already added cache_control inline, leave it alone.
  // We only want to *add* markers when none exist.
  if (hasInlineCacheControl(body.system) || hasInlineCacheControl(body.messages) || hasInlineCacheControl(body.tools)) {
    metrics.promptCache.reason = "client-supplied";
    metrics.promptCache.applied = false;
    return;
  }

  // Inject cache_control on the last system content block (if system is an array of blocks).
  let injected = false;
  if (Array.isArray(body.system)) {
    if (markLastBlockEphemeral(body.system)) {
      metrics.promptCache.locations.push("system[last]");
      injected = true;
    }
  } else if (typeof body.system === "string" && body.system.length > 0) {
    // Convert string system into a single block array so we can attach cache_control.
    body.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
    metrics.promptCache.locations.push("system[converted-string]");
    injected = true;
  }

  // Also mark the last assistant/user content block of the most recent user turn as a second
  // breakpoint. Anthropic supports up to 4 cache_control breakpoints; two is plenty and gives us
  // both system-level and per-turn caching.
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const lastUserIdx = (() => {
      for (let i = body.messages.length - 1; i >= 0; i -= 1) {
        if (body.messages[i]?.role === "user") return i;
      }
      return -1;
    })();
    if (lastUserIdx !== -1) {
      const msg = body.messages[lastUserIdx];
      if (Array.isArray(msg.content) && markLastBlockEphemeral(msg.content)) {
        metrics.promptCache.locations.push(`messages[${lastUserIdx}].content[last]`);
        injected = true;
      }
    }
  }

  metrics.promptCache.applied = injected;
  metrics.promptCache.reason = injected ? "inline-blocks" : "no-injectable-blocks";
}

// Optional provider pinning: when OPENROUTER_PROXY_PIN_PROVIDER=on, look up the model's
// observed.latestProvider in the registry and add an OpenRouter `provider` preference so the
// upstream sticks to that provider (better for cache continuity). Never overrides a client-supplied
// `provider` field.
function applyProviderPinIfSafe(body, metrics) {
  metrics.providerPin = { applied: false, reason: "disabled", provider: null };
  if (!PIN_PROVIDER) return;
  if (!body || typeof body !== "object") return;
  if (body.provider) {
    metrics.providerPin.reason = "client-supplied";
    return;
  }
  const entry = findRegistryEntry(body.model || "");
  const pinned = entry?.observed?.latestProvider;
  if (!pinned) {
    metrics.providerPin.reason = "no-observed-provider";
    return;
  }
  body.provider = { order: [pinned], allow_fallbacks: false };
  metrics.providerPin.applied = true;
  metrics.providerPin.reason = "registry-observed";
  metrics.providerPin.provider = pinned;
}

function detectSource(req) {
  return (
    req.headers["x-cc-openrouter-source"] ||
    req.headers["x-title"] ||
    req.headers["user-agent"] ||
    "unknown"
  );
}

function detectMode(req) {
  const header = String(req.headers["x-cc-openrouter-mode"] || "").toLowerCase();
  if (header === "full" || header === "low-token") return header;
  return "unknown";
}

function budgetWarnings(metrics) {
  const warnings = [];
  const model = metrics.selectedModel || "";
  if (/deepseek/i.test(model)) warnings.push("deepseek-selected");
  if (metrics.estimatedInputTokens > WARN_CONTEXT_TOKENS) warnings.push("large-context-estimate");
  if (metrics.mode === "low-token" && metrics.estimatedInputTokens > LOW_TOKEN_MAX_ESTIMATED_TOKENS) {
    warnings.push("low-token-request-too-large");
  }
  return warnings;
}

function contextAdvice(metrics) {
  const advice = [];
  if (metrics.estimatedInputTokens > WARN_CONTEXT_TOKENS) {
    advice.push("compact-recommended-observe-only");
  }
  if (metrics.estimatedInputTokens > WARN_CONTEXT_TOKENS * 2) {
    advice.push("fresh-session-recommended-observe-only");
  }
  return advice;
}

function strictBudgetBlocked(warnings) {
  if (!STRICT_BUDGET) return false;
  return warnings.includes("large-context-estimate") || warnings.includes("low-token-request-too-large") || warnings.includes("deepseek-selected");
}

function isHiddenBlock(block) {
  return block && typeof block === "object" && HIDDEN_CONTENT_TYPES.has(block.type);
}

function sanitizeJson(value, metrics) {
  if (Array.isArray(value)) {
    return value.filter((item) => !isHiddenBlock(item)).map((item) => sanitizeJson(item, metrics));
  }

  if (!value || typeof value !== "object") return value;
  if (isHiddenBlock(value)) {
    metrics.responseHiddenBlocksRemoved += 1;
    return null;
  }

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "content" && Array.isArray(child)) {
      const filtered = child.filter((item) => {
        if (!isHiddenBlock(item)) return true;
        metrics.responseHiddenBlocksRemoved += 1;
        return false;
      });
      next[key] = filtered.map((item) => sanitizeJson(item, metrics));
      continue;
    }

    const clean = sanitizeJson(child, metrics);
    if (clean !== null) next[key] = clean;
  }
  return next;
}

// Pick the larger numeric value, treating null/undefined as "unset". This is the right policy for
// streamed Anthropic responses where `message_start` reports input_tokens with output_tokens=0,
// then `message_delta` reports the final cumulative output_tokens. First-write-wins (the previous
// `??=` behavior) was capturing the 0 and never updating, which broke observed cost calculations.
function maxAssign(metrics, key, value) {
  if (value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const current = metrics[key];
  if (current === null || current === undefined || Number(current) < n) {
    metrics[key] = n;
  }
}

function absorbUsage(metrics, obj) {
  if (!obj || typeof obj !== "object") return;
  const candidates = [obj, obj.message, obj.delta, obj.usage, obj.message?.usage, obj.delta?.usage].filter(Boolean);

  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.provider === "string") metrics.provider = item.provider;
    if (typeof item.model === "string") metrics.actualModel = item.model;
    if (typeof item.stop_reason === "string") metrics.finishReason = item.stop_reason;
    if (typeof item.finish_reason === "string") metrics.finishReason = item.finish_reason;
    if (typeof item.stopReason === "string") metrics.finishReason = item.stopReason;
    if (typeof item.finishReason === "string") metrics.finishReason = item.finishReason;

    const usage = item.usage && typeof item.usage === "object" ? item.usage : item;
    // Use max-wins for cumulative counters. Streamed events report increasing values; the final
    // event has the truth. Static `message_start` events never decrease so this is also safe for
    // single-shot JSON responses.
    maxAssign(metrics, "inputTokens", usage.input_tokens ?? usage.prompt_tokens);
    maxAssign(metrics, "outputTokens", usage.output_tokens ?? usage.completion_tokens);
    maxAssign(metrics, "reasoningTokens", usage.reasoning_tokens ?? usage.reasoningTokens);
    maxAssign(metrics, "cacheCreationTokens", usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_write_tokens);
    maxAssign(metrics, "cacheReadTokens", usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens);
    maxAssign(metrics, "cachedTokens", usage.prompt_tokens_details?.cached_tokens);
    // Cost is monotonic non-decreasing in OpenRouter responses, so max-wins works here too.
    const cost = usage.cost ?? usage.total_cost_usd ?? usage.cost_usd;
    if (cost !== null && cost !== undefined && Number.isFinite(Number(cost))) {
      const n = Number(cost);
      if (metrics.costUsd === null || metrics.costUsd === undefined || metrics.costUsd < n) {
        metrics.costUsd = n;
      }
    }
  }

  if (obj.cost_details?.upstream_inference_cost !== undefined) {
    const n = Number(obj.cost_details.upstream_inference_cost);
    if (Number.isFinite(n) && (metrics.costUsd === null || metrics.costUsd === undefined || metrics.costUsd < n)) {
      metrics.costUsd = n;
    }
  }
}

function shouldDropSseEvent(event, hiddenIndexes, metrics) {
  const index = event.index;
  absorbUsage(metrics, event);

  if (event.type === "content_block_start" && isHiddenBlock(event.content_block)) {
    if (Number.isInteger(index)) hiddenIndexes.add(index);
    metrics.responseHiddenBlocksRemoved += 1;
    return true;
  }

  if (Number.isInteger(index) && hiddenIndexes.has(index)) {
    if (event.type === "content_block_stop") hiddenIndexes.delete(index);
    return true;
  }

  if (event.type === "content_block_delta") {
    const deltaType = event.delta?.type || "";
    if (deltaType.includes("thinking") || deltaType.includes("redacted")) {
      metrics.responseHiddenBlocksRemoved += 1;
      return true;
    }
  }

  return false;
}

function sanitizeSseBlock(block, hiddenIndexes, metrics) {
  if (block.length === 0) return [];

  const dataLines = block.filter((line) => line.startsWith("data:"));
  if (dataLines.length === 0) return block;

  const payload = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
  if (!payload || payload === "[DONE]") return block;

  try {
    const event = JSON.parse(payload);
    if (shouldDropSseEvent(event, hiddenIndexes, metrics)) return null;
    const cleanData = `data: ${JSON.stringify(sanitizeJson(event, metrics))}`;
    return block.filter((line) => !line.startsWith("data:")).concat(cleanData);
  } catch {
    return block;
  }
}

async function streamSanitizedSse(upstreamResponse, res, metrics) {
  const hiddenIndexes = new Set();
  const decoder = new TextDecoder();
  let pending = "";
  let block = [];

  for await (const chunk of upstreamResponse.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      if (line === "") {
        const clean = sanitizeSseBlock(block, hiddenIndexes, metrics);
        if (clean !== null) res.write(`${clean.join("\n")}\n\n`);
        block = [];
      } else {
        block.push(line);
      }
    }
  }

  if (pending) block.push(pending);
  if (block.length > 0) {
    const clean = sanitizeSseBlock(block, hiddenIndexes, metrics);
    if (clean !== null) res.write(`${clean.join("\n")}\n\n`);
  }

  res.end();
}

function copyResponseHeaders(upstreamResponse, res, bodyLength, warnings) {
  for (const [key, value] of upstreamResponse.headers.entries()) {
    const lower = key.toLowerCase();
    if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(lower)) continue;
    res.setHeader(key, value);
  }
  if (warnings.length > 0) res.setHeader("x-openrouter-proxy-warning", warnings.join(","));
  if (bodyLength !== undefined) res.setHeader("content-length", String(bodyLength));
}

function writeMetrics(metrics) {
  const summary = {
    timestamp: new Date().toISOString(),
    requestId: metrics.requestId,
    source: metrics.source,
    mode: metrics.mode,
    originalSelectedModel: metrics.originalSelectedModel,
    selectedModel: metrics.selectedModel,
    actualModel: metrics.actualModel,
    requestBodyBytes: metrics.requestBodyBytes,
    estimatedInputTokens: metrics.estimatedInputTokens,
    messageCount: metrics.messageCount,
    systemChars: metrics.systemChars,
    toolCount: metrics.toolCount,
    toolSchemaBytes: metrics.toolSchemaBytes,
    thinkingRemoved: metrics.thinkingRemoved,
    thinkingRemovedFields: metrics.thinkingRemovedFields,
    responseHiddenBlocksRemoved: metrics.responseHiddenBlocksRemoved,
    upstreamStatus: metrics.upstreamStatus,
    provider: metrics.provider,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    reasoningTokens: metrics.reasoningTokens,
    cacheCreationTokens: metrics.cacheCreationTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    cachedTokens: metrics.cachedTokens,
    costUsd: metrics.costUsd,
    latencyMs: metrics.latencyMs,
    finishReason: metrics.finishReason,
    retryCount: metrics.retryCount,
    retryReasons: metrics.retryReasons,
    warnings: metrics.warnings,
    contextAdvice: metrics.contextAdvice,
    promptCache: metrics.promptCache,
    providerPin: metrics.providerPin,
    modelRemap: metrics.modelRemap,
    reasoningPolicy: metrics.reasoningPolicy,
    responseCache: metrics.responseCache,
  };

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LAST_METRICS, `${JSON.stringify(summary, null, 2)}\n`);
    if (DEBUG_TOKENS) fs.appendFileSync(METRICS_LOG, `${JSON.stringify(summary)}\n`);
  } catch (error) {
    log(`[metrics] failed: ${error.message}`);
  }
}

function newMetrics(req, rawBody) {
  return {
    requestId: crypto.randomUUID(),
    source: detectSource(req),
    mode: detectMode(req),
    requestBodyBytes: rawBody.length,
    estimatedInputTokens: Math.ceil(rawBody.length / 4),
    messageCount: 0,
    systemChars: 0,
    toolCount: 0,
    toolSchemaBytes: 0,
    selectedModel: null,
    originalSelectedModel: null,
    actualModel: null,
    thinkingRemoved: false,
    thinkingRemovedFields: [],
    responseHiddenBlocksRemoved: 0,
    upstreamStatus: null,
    provider: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    cachedTokens: null,
    costUsd: null,
    latencyMs: null,
    finishReason: null,
    retryCount: 0,
    retryReasons: [],
    warnings: [],
    contextAdvice: [],
    promptCache: { mode: PROMPT_CACHE, applied: false, reason: "not-json", locations: [] },
    providerPin: { applied: false, reason: PIN_PROVIDER ? "no-observed-provider" : "disabled", provider: null },
    modelRemap: { enabled: null, applied: false, type: "internal-haiku", from: null, to: null, targetRole: null, reason: "not-json" },
    reasoningPolicy: { action: "none", reason: "not-json" },
    responseCache: { enabled: RESPONSE_CACHE, applied: false },
  };
}

function retryDelayMs(attempt, status) {
  if (status === 429) return Math.min(2_000, 500 * 2 ** attempt);
  return Math.min(1_500, 250 * 2 ** attempt);
}

async function fetchWithTransientRetry(upstreamUrl, options, metrics) {
  let lastError = null;
  const maxAttempts = RETRY_TRANSIENT ? MAX_RETRIES + 1 : 1;
  const retryMetrics = metrics || { retryCount: 0, retryReasons: [] };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(upstreamUrl, options);
      if (!RETRY_TRANSIENT || attempt >= maxAttempts - 1 || !RETRY_STATUS_CODES.has(response.status)) {
        return response;
      }
      retryMetrics.retryCount += 1;
      retryMetrics.retryReasons.push(`http-${response.status}`);
      try {
        await response.arrayBuffer();
      } catch {
        // Best effort drain before retry.
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, response.status)));
    } catch (error) {
      lastError = error;
      if (!RETRY_TRANSIENT || attempt >= maxAttempts - 1) throw error;
      retryMetrics.retryCount += 1;
      retryMetrics.retryReasons.push(`fetch-error:${error?.code || error?.name || "unknown"}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, 0)));
    }
  }

  throw lastError || new Error("fetch failed");
}

async function handle(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    const remap = internalHaikuRemapConfig();
    res.end(JSON.stringify({
      ok: true,
      upstream: UPSTREAM,
      features: {
        debugTokens: DEBUG_TOKENS,
        promptCache: PROMPT_CACHE,
        pinProvider: PIN_PROVIDER,
        remapInternalHaiku: remap.enabled,
        remapInternalHaikuTargetRole: remap.targetRole,
        reasoningPolicy: "strip-unless-registry-allowlisted-and-effort-high",
        retryTransient: RETRY_TRANSIENT,
        maxRetries: MAX_RETRIES,
      },
    }));
    return;
  }

  const start = Date.now();
  const originalUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const upstreamPath = originalUrl.pathname.startsWith("/api/")
    ? originalUrl.pathname.slice(4)
    : originalUrl.pathname;
  const upstreamUrl = `${UPSTREAM}${upstreamPath}${originalUrl.search}`;
  const isMessagesRequest = req.method === "POST" && upstreamPath.endsWith("/v1/messages");

  const rawBody = ["GET", "HEAD"].includes(req.method || "") ? Buffer.alloc(0) : await readRequest(req);
  const metrics = newMetrics(req, rawBody);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (["host", "connection", "content-length", "accept-encoding"].includes(lower)) continue;
    if (lower.startsWith("x-cc-openrouter-")) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("accept-encoding", "identity");
  headers.set("HTTP-Referer", headers.get("HTTP-Referer") || "http://127.0.0.1:4141");
  headers.set("X-Title", headers.get("X-Title") || "Claude Code OpenRouter Proxy");

  const contentType = headers.get("content-type") || "";
  let requestBody;

  if (rawBody.length && contentType.includes("application/json")) {
    let body = safeJsonParse(rawBody);
    if (body) {
      Object.assign(metrics, describeBody(body, rawBody.length));
      const sanitized = sanitizeRequestBody(body);
      body = sanitized.body;
      metrics.thinkingRemoved = sanitized.removed;
      metrics.thinkingRemovedFields = sanitized.removedFields;
      metrics.reasoningPolicy = sanitized.reasoningPolicy;
      applyInternalHaikuRemapIfSafe(body, metrics);
      applyPromptCacheIfSafe(body, metrics);
      applyProviderPinIfSafe(body, metrics);
      Object.assign(metrics, describeBody(body, byteLength(body)));
      requestBody = Buffer.from(JSON.stringify(body));
    } else {
      requestBody = rawBody;
    }
  } else {
    requestBody = rawBody.length ? rawBody : undefined;
  }

  if (RESPONSE_CACHE && metrics.mode === "low-token" && metrics.toolCount === 0) {
    headers.set("X-OpenRouter-Cache", "true");
    if (process.env.OPENROUTER_PROXY_RESPONSE_CACHE_TTL) {
      headers.set("X-OpenRouter-Cache-TTL", process.env.OPENROUTER_PROXY_RESPONSE_CACHE_TTL);
    }
    metrics.responseCache.applied = true;
  }

  if (requestBody) headers.set("content-length", String(requestBody.length));

  metrics.warnings = budgetWarnings(metrics);
  metrics.contextAdvice = contextAdvice(metrics);
  if (metrics.warnings.length > 0) log(`[budget] ${metrics.requestId} ${metrics.warnings.join(",")} model=${metrics.selectedModel} est_tokens=${metrics.estimatedInputTokens}`);

  if (strictBudgetBlocked(metrics.warnings)) {
    metrics.latencyMs = Date.now() - start;
    if (isMessagesRequest) writeMetrics(metrics);
    res.writeHead(402, { "content-type": "application/json", "x-openrouter-proxy-warning": metrics.warnings.join(",") });
    res.end(JSON.stringify({
      error: {
        type: "budget_guard",
        message: "OpenRouter proxy strict budget guard blocked this request. Use full mode intentionally, lower context, or disable OPENROUTER_PROXY_BUDGET_STRICT.",
        warnings: metrics.warnings,
      },
    }));
    return;
  }

  const upstreamResponse = await fetchWithTransientRetry(upstreamUrl, {
    method: req.method,
    headers,
    body: requestBody,
  }, metrics);

  metrics.upstreamStatus = upstreamResponse.status;
  const responseType = upstreamResponse.headers.get("content-type") || "";
  res.statusCode = upstreamResponse.status;
  res.statusMessage = upstreamResponse.statusText;

  if (responseType.includes("text/event-stream")) {
    copyResponseHeaders(upstreamResponse, res, undefined, metrics.warnings);
    await streamSanitizedSse(upstreamResponse, res, metrics);
    metrics.latencyMs = Date.now() - start;
    if (metrics.costUsd !== null && metrics.costUsd > WARN_COST_USD) metrics.warnings.push("observed-cost-over-threshold");
    if (isMessagesRequest) writeMetrics(metrics);
    return;
  }

  const raw = Buffer.from(await upstreamResponse.arrayBuffer());
  if (responseType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      absorbUsage(metrics, parsed);
      const clean = Buffer.from(JSON.stringify(sanitizeJson(parsed, metrics)));
      copyResponseHeaders(upstreamResponse, res, clean.length, metrics.warnings);
      res.end(clean);
      metrics.latencyMs = Date.now() - start;
      if (metrics.costUsd !== null && metrics.costUsd > WARN_COST_USD) metrics.warnings.push("observed-cost-over-threshold");
      if (isMessagesRequest) writeMetrics(metrics);
      return;
    } catch {
      // Raw response fallback.
    }
  }

  copyResponseHeaders(upstreamResponse, res, raw.length, metrics.warnings);
  res.end(raw);
  metrics.latencyMs = Date.now() - start;
  if (isMessagesRequest) writeMetrics(metrics);
}

await patchExtensions();
setInterval(patchExtensions, PATCH_INTERVAL_MS).unref();

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`[proxy] request failed: ${error?.message || String(error)}`);
    if (res.headersSent || res.writableEnded) {
      try {
        res.end();
      } catch {
        // Response is already closed.
      }
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "proxy_error" } }));
  });
});

server.on("error", (error) => {
  log(`[proxy] failed: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const remap = internalHaikuRemapConfig();
  log(`[proxy] listening http://127.0.0.1:${PORT}`);
  log(`[proxy] upstream ${UPSTREAM}`);
  log(`[proxy] debug_tokens=${DEBUG_TOKENS} budget_strict=${STRICT_BUDGET} prompt_cache=${PROMPT_CACHE} pin_provider=${PIN_PROVIDER} response_cache=${RESPONSE_CACHE} remap_internal_haiku=${remap.enabled} remap_target_role=${remap.targetRole}`);
});
