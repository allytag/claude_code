import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { patchAllExtensions } from "./patch-extension.mjs";

const execFileAsync = promisify(execFile);
const SETTINGS = "__HOME__/.claude/settings.json";
const VSCODE_SETTINGS = "__HOME__/Library/Application Support/Code/User/settings.json";
const LAUNCH_AGENT = "__HOME__/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist";
const EXTENSIONS_DIR = "__HOME__/.vscode/extensions";
const LAST_METRICS = "__HOME__/.claude/logs/openrouter-claude-proxy-last-metrics.json";
const METRICS_LOG = "__HOME__/.claude/logs/openrouter-claude-proxy-metrics.jsonl";
const MODEL_REGISTRY = "__HOME__/.claude/openrouter-claude-proxy/model-registry.json";
const CLAUDE_ENV = "__HOME__/.claude/openrouter-claude-proxy/claude-env.mjs";
const LAST_SAFE_UPDATE = "__HOME__/.claude/logs/last-safe-update.json";
const SKILLS_DIR = "__HOME__/.claude/skills";
const AGENTS_DIR = "__HOME__/.claude/agents";
const COMMANDS_DIR = "__HOME__/.claude/commands";
const STATUSLINE = "__HOME__/.claude/statusline-openrouter-lts.mjs";
const SKILL_INBOX = "__HOME__/.claude/skill-inbox";
const AGENT_POLICY = "__HOME__/.claude/agent-policy.json";
const SKILL_GUARD = "__HOME__/.claude/openrouter-claude-proxy/skill-guard.mjs";
const WRAPPERS = [
  "__HOME__/.local/bin/claude-router",
  "__HOME__/.local/bin/or-model",
  "__HOME__/.local/bin/claude-model",
  "__HOME__/.local/bin/claude-role",
  "__HOME__/.local/bin/claude-low",
  "__HOME__/.local/bin/claude-full",
  "__HOME__/.local/bin/claude-kimi",
  "__HOME__/.local/bin/claude-qwen",
  "__HOME__/.local/bin/claude-deepseek",
  "__HOME__/.local/bin/claude-safe-update",
];

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function maybeReadJson(file) {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

async function readJsonlTail(file, limit = 5) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function command(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 20_000, ...options });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() || "", stderr: error.stderr?.trim() || error.message };
  }
}

async function plistJson(file) {
  const out = await command("plutil", ["-convert", "json", "-o", "-", file]);
  if (!out.ok) return null;
  return JSON.parse(out.stdout);
}

async function extensionVersions() {
  const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("anthropic.claude-code-"))
    .map((entry) => path.join(EXTENSIONS_DIR, entry.name))
    .sort();

  const versions = [];
  for (const dir of dirs) {
    const pkg = await maybeReadJson(path.join(dir, "package.json"));
    versions.push({ dir, version: pkg?.version || "unknown" });
  }
  return versions;
}

async function wrapperStatus() {
  const result = {};
  for (const wrapper of WRAPPERS) {
    try {
      await fs.access(wrapper, fs.constants.X_OK);
      result[wrapper] = "executable";
    } catch {
      result[wrapper] = "missing-or-not-executable";
    }
  }
  return result;
}

async function listInstalledAssets(settings = null) {
  async function listNames(dir, suffix = "") {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() || !suffix || entry.name.endsWith(suffix))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }
  const skills = await listNames(SKILLS_DIR);
  const agents = await listNames(AGENTS_DIR, ".md");
  const commands = await listNames(COMMANDS_DIR, ".md");
  const inboxEntries = await listNames(SKILL_INBOX);
  const agentPolicy = await maybeReadJson(AGENT_POLICY);
  const agentPolicyDrift = await summarizeAgentPolicy(agentPolicy, settings);
  let statusline = "missing";
  try {
    await fs.access(STATUSLINE, fs.constants.X_OK);
    statusline = "executable";
  } catch {
    try {
      await fs.access(STATUSLINE);
      statusline = "present-not-executable";
    } catch {
      statusline = "missing";
    }
  }
  return {
    skills: { count: skills.length, names: skills },
    agents: { count: agents.length, names: agents },
    commands: { count: commands.length, names: commands },
    skillInbox: { count: inboxEntries.length, path: SKILL_INBOX, entries: inboxEntries },
    skillGuard: { path: SKILL_GUARD, status: await executableStatus(SKILL_GUARD) },
    agentPolicy: agentPolicyDrift,
    statusline,
  };
}

async function executableStatus(file) {
  try {
    await fs.access(file, fs.constants.X_OK);
    return "executable";
  } catch {
    try {
      await fs.access(file);
      return "present-not-executable";
    } catch {
      return "missing";
    }
  }
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const raw = text.slice(4, end).trim();
  const data = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return data;
}

async function summarizeAgentPolicy(policy, settings = null) {
  const entries = Object.entries(policy?.agents || {});
  const agentFiles = await fs.readdir(AGENTS_DIR).catch(() => []);
  const actual = {};
  for (const file of agentFiles.filter((name) => name.endsWith(".md"))) {
    const text = await fs.readFile(path.join(AGENTS_DIR, file), "utf8").catch(() => "");
    const fm = parseFrontmatter(text);
    if (fm.name) actual[fm.name] = { file, model: fm.model || null };
  }
  const drift = [];
  for (const [name, expected] of entries) {
    if (!actual[name]) {
      drift.push({ agent: name, issue: "missing-agent", expectedModel: expected.model });
    } else if (expected.model && actual[name].model !== expected.model) {
      drift.push({ agent: name, issue: "model-mismatch", expectedModel: expected.model, actualModel: actual[name].model });
    }
  }
  for (const [name, info] of Object.entries(actual)) {
    if (!policy?.agents?.[name]) drift.push({ agent: name, issue: "missing-policy", actualModel: info.model });
  }
  const mode = policy?.subagentModelMode || null;
  const globalOverride = settings?.env?.CLAUDE_CODE_SUBAGENT_MODEL || null;
  const shadowed = Boolean(mode === "frontmatter" && globalOverride);
  if (shadowed) {
    drift.push({
      agent: "*",
      issue: "global-subagent-override-shadows-frontmatter",
      action: "unset CLAUDE_CODE_SUBAGENT_MODEL to allow per-agent model frontmatter",
    });
  }
  return {
    path: AGENT_POLICY,
    present: Boolean(policy),
    mode,
    globalSubagentOverride: globalOverride ? "set" : "unset",
    shadowedByGlobalOverride: shadowed,
    effectiveRouting: shadowed ? "global-override" : (mode === "frontmatter" ? "frontmatter" : "default"),
    entryCount: entries.length,
    drift: drift.length > 0 || shadowed,
    driftItems: drift,
  };
}

function launchAgentEnv(plist) {
  return plist?.EnvironmentVariables || {};
}

function envValue(env, key, defaultValue) {
  return env[key] ?? process.env[key] ?? defaultValue;
}

function safeMetrics(metrics) {
  if (!metrics) return null;
  return {
    timestamp: metrics.timestamp,
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
    responseHiddenBlocksRemoved: metrics.responseHiddenBlocksRemoved,
    upstreamStatus: metrics.upstreamStatus,
    provider: metrics.provider,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    reasoningTokens: metrics.reasoningTokens,
    cacheCreationTokens: metrics.cacheCreationTokens,
    cacheReadTokens: metrics.cacheReadTokens,
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
  };
}

function detectDrift(settings, registry) {
  if (!settings || !registry) return { drift: false, items: [], note: "incomplete-data" };
  const slots = registry.claudeSlots || {};
  const items = [];

  function expected(slotName) {
    const role = slots[slotName];
    if (!role) return null;
    const alias = registry.roles?.[role];
    return registry.models?.[alias]?.id || null;
  }

  const checks = [
    ["sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
    ["haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL"],
    ["opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"],
    ["custom", "ANTHROPIC_CUSTOM_MODEL_OPTION"],
  ];
  for (const [slot, envField] of checks) {
    const want = expected(slot);
    const have = settings.env?.[envField];
    if (want && have && want !== have) items.push({ slot, want, have });
  }

  const subagentAlias = registry.roles?.[slots.subagent || "subagent"];
  const wantSubagent = registry.models?.[subagentAlias]?.id;
  const haveSubagent = settings.env?.CLAUDE_CODE_SUBAGENT_MODEL;
  if (wantSubagent && haveSubagent && wantSubagent !== haveSubagent) {
    items.push({ slot: "subagent", want: wantSubagent, have: haveSubagent });
  }

  const wantDefault = slots.defaultSlot || "sonnet";
  const haveDefault = settings.model;
  if (haveDefault && wantDefault !== haveDefault) {
    items.push({ slot: "defaultSlot", want: wantDefault, have: haveDefault });
  }

  return {
    drift: items.length > 0,
    items,
    note: items.length === 0 ? "settings match registry" : "run: or-model apply-settings --dry-run",
  };
}

function modelCacheReadiness(registry) {
  if (!registry) return [];
  const out = [];
  for (const [alias, model] of Object.entries(registry.models || {})) {
    const cb = model.compatibility?.cacheBehavior || "unknown";
    let verdict;
    if (cb === "cache-read-observed") verdict = "ready";
    else if (cb === "cache-create-only-observed") verdict = "needs-second-turn";
    else if (cb === "tiny-cache-read-observed") verdict = "weak";
    else if (cb === "no-cache-read-observed") verdict = "not-working";
    else verdict = "unknown";
    out.push({ alias, id: model.id, verdict, observedProvider: model.observed?.latestProvider || null });
  }
  return out;
}

function nextActionHint({ drift, recentMetrics, lastMetrics, registry }) {
  const hints = [];
  if (drift?.drift) {
    hints.push("Settings drifted from registry. Run: or-model apply-settings --dry-run, then apply when satisfied.");
  }
  if ((!recentMetrics || recentMetrics.length === 0) && !lastMetrics) {
    hints.push("No proxy metrics yet. Make one real Claude Code call so doctor can diagnose token/cost.");
  }
  if (lastMetrics?.cacheReadTokens === 0 && lastMetrics?.actualModel && /kimi/i.test(lastMetrics.actualModel)) {
    hints.push("Kimi cache_read=0 in last call. To test prompt cache, set OPENROUTER_PROXY_PROMPT_CACHE=auto and run two same-session turns.");
  }
  if (registry) {
    const noProvider = Object.values(registry.models || {}).filter((m) => !m.observed?.latestProvider);
    if (noProvider.length > 0) {
      hints.push(`${noProvider.length} model(s) have no observed provider — provider pinning is unavailable for them.`);
    }
  }
  if (hints.length === 0) hints.push("All checks pass. Safe to run a real-test session when ready.");
  return hints;
}

function cacheTrend(requests) {
  const usable = requests.filter((item) => item && item.upstreamStatus && item.selectedModel);
  const totalCacheRead = usable.reduce((sum, item) => sum + Number(item.cacheReadTokens || 0), 0);
  const totalCacheCreation = usable.reduce((sum, item) => sum + Number(item.cacheCreationTokens || 0), 0);
  const byRequest = usable.map((item) => ({
    timestamp: item.timestamp,
    model: item.actualModel || item.selectedModel,
    cacheCreationTokens: item.cacheCreationTokens ?? null,
    cacheReadTokens: item.cacheReadTokens ?? null,
  }));

  let verdict = "not-enough-data";
  if (usable.length >= 2 && totalCacheRead > 0) verdict = "cache-read-observed";
  if (usable.length >= 2 && totalCacheRead === 0 && totalCacheCreation > 0) verdict = "cache-create-only-observed";
  if (usable.length >= 2 && totalCacheRead === 0 && totalCacheCreation === 0) verdict = "no-cache-observed";

  return {
    verdict,
    requestCount: usable.length,
    totalCacheCreationTokens: totalCacheCreation,
    totalCacheReadTokens: totalCacheRead,
    byRequest,
  };
}

function summarizeRegistry(registry) {
  if (!registry) return null;
  const models = registry.models || {};
  const roles = {};
  for (const [role, alias] of Object.entries(registry.roles || {})) {
    roles[role] = {
      alias,
      id: models[alias]?.id || "missing",
      catalogInputUsdPerMTok: models[alias]?.catalog?.inputUsdPerMTok ?? null,
      catalogOutputUsdPerMTok: models[alias]?.catalog?.outputUsdPerMTok ?? null,
      observedProvider: models[alias]?.observed?.latestProvider ?? null,
      observedCostUsd: models[alias]?.observed?.latestCostUsd ?? null,
      cacheBehavior: models[alias]?.compatibility?.cacheBehavior ?? "unknown",
      reasoningPassThrough: models[alias]?.compatibility?.reasoningPassThrough === true,
    };
  }
  return {
    path: MODEL_REGISTRY,
    schemaVersion: registry.schemaVersion,
    updatedAt: registry.updatedAt,
    modelCount: Object.keys(models).length,
    roles,
    claudeSlots: registry.claudeSlots || {},
    remaps: registry.remaps || {},
  };
}

function modelIdForRole(registry, role) {
  const alias = registry?.roles?.[role];
  return alias ? registry?.models?.[alias]?.id || null : null;
}

function globToRegex(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => globToRegex(pattern).test(String(value || "")));
}

function internalHaikuLike(metrics) {
  const candidates = [
    metrics?.originalSelectedModel,
    metrics?.modelRemap?.from,
    metrics?.selectedModel,
    metrics?.actualModel,
  ].filter(Boolean);
  return candidates.some((value) => {
    const model = String(value);
    return /claude.*haiku|haiku.*claude/i.test(model);
  });
}

function summarizeInternalHaikuRemap(registry, metrics) {
  const cfg = registry?.remaps?.internalHaiku || {};
  const matching = metrics.filter(internalHaikuLike);
  const applied = metrics.filter((item) => item?.modelRemap?.type === "internal-haiku" && item.modelRemap.applied);
  const missed = metrics.filter((item) => internalHaikuLike(item) && item?.modelRemap?.applied !== true);
  const patterns = cfg.sourceModelPatterns || [];
  const currentPatternMisses = matching.filter((item) => {
    const from = item.originalSelectedModel || item.modelRemap?.from || item.selectedModel;
    return !matchesAnyPattern(from, patterns);
  });
  return {
    configured: Boolean(registry),
    enabled: cfg.enabled !== false,
    envFlag: process.env.OPENROUTER_PROXY_REMAP_INTERNAL_HAIKU ?? "plist-or-default",
    targetRole: cfg.targetRole || "cheapFull",
    targetModel: modelIdForRole(registry, cfg.targetRole || "cheapFull"),
    safety: cfg.safety || {},
    observedHiddenHaikuCalls: matching.length,
    observedHiddenHaikuCostUsd: Number(matching.reduce((sum, item) => sum + Number(item.costUsd || 0), 0).toFixed(8)),
    remappedCallsObserved: applied.length,
    historicalNotRemappedHaikuLikeCallsObserved: missed.length,
    currentPatternMissesObserved: currentPatternMisses.length,
    missedWarning: currentPatternMisses.length > 0 ? "Current sourceModelPatterns still miss at least one Haiku-like model." : null,
    lastObserved: matching.slice(-5).map((item) => ({
      timestamp: item.timestamp,
      source: item.source,
      from: item.originalSelectedModel || item.modelRemap?.from || item.selectedModel,
      to: item.modelRemap?.to || null,
      applied: Boolean(item.modelRemap?.applied),
      provider: item.provider,
      costUsd: item.costUsd,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      toolCount: item.toolCount,
      messageCount: item.messageCount,
      reason: item.modelRemap?.reason || null,
      warning: item.modelRemap?.warning || null,
    })),
  };
}

function cleanupPolicySummary() {
  return {
    command: "claude-router cleanup all-safe --dry-run",
    aliasCommand: "or-model cleanup all-safe --dry-run",
    defaultMode: "dry-run",
    applyRequires: "--apply",
    newestBackupPerSourceKept: true,
    settingsJsonBackupsProtected: true,
    fileHistoryPolicy: "delete whole UUID dirs older than threshold, never partial files, keep newest dir",
    extensionSnapshotPolicy: "delete whole safe-update extension snapshot dirs older than threshold, keep newest snapshot",
    telemetryPolicy: "delete only telemetry/1p_failed_events*.json older than threshold",
    protectedTrees: [
      "__HOME__/Library/Application Support/Claude",
      "__HOME__/.claude/plugins",
      "__HOME__/.claude/plugins/cache/caveman",
      "__HOME__/.claude/openrouter-claude-proxy current runtime files",
      "__HOME__/.vscode/extensions/anthropic.claude-code-* folders",
    ],
  };
}

function summarizeSafeUpdate(record, activeVersion, recentMetrics) {
  if (!record) {
    return {
      configured: true,
      lastRecord: null,
      status: "no-safe-update-record-yet",
      command: "claude-safe-update latest --dry-run",
      notes: [
        "No scheduled update tests. No model calls unless claude-safe-update --probe --allow-model-call is used.",
        "DISABLE_AUTOUPDATER should be set so manual claude-safe-update is the controlled update path.",
      ],
    };
  }
  const newVersion = record.newVersion || "unknown";
  const activeMatchesRecord = activeVersion === newVersion;
  const recordTime = Date.parse(record.timestamp || "");
  const failuresAfterRecord = Number.isFinite(recordTime)
    ? recentMetrics.filter((item) => {
        const ts = Date.parse(item?.timestamp || "");
        return Number.isFinite(ts) && ts > recordTime && item?.upstreamStatus && item.upstreamStatus >= 400;
      })
    : 0;
  const failedAfterRecord = Array.isArray(failuresAfterRecord) ? failuresAfterRecord.length : 0;
  const modelNotFoundFailures = Array.isArray(failuresAfterRecord)
    ? failuresAfterRecord.filter((item) => item.upstreamStatus === 404 && item.selectedModel).length
    : 0;
  const seriousFailures = Array.isArray(failuresAfterRecord)
    ? failuresAfterRecord.filter((item) => {
        if (item.upstreamStatus === 404 && item.selectedModel) return false;
        return item.upstreamStatus >= 400;
      })
    : [];
  let status = activeMatchesRecord ? "active-version-matches-last-safe-update" : "active-version-differs-from-last-safe-update";
  if (seriousFailures.length > 0) status = "post-update-regression-suspected";
  else if (modelNotFoundFailures > 0) status = "post-update-model-404-observed";
  return {
    configured: true,
    path: LAST_SAFE_UPDATE,
    status,
    activeVersion,
    recordVersion: newVersion,
    timestamp: record.timestamp,
    target: record.target,
    oldVersion: record.oldVersion,
    newVersion,
    snapshotPath: record.snapshot?.path || null,
    extensionSnapshotPath: record.extensionSnapshot?.path || null,
    extensionSnapshotCount: record.extensionSnapshot?.count ?? null,
    validationOk: record.validation?.ok === true,
    failedProxyCallsAfterRecord: failedAfterRecord,
    seriousProxyFailuresAfterRecord: seriousFailures.length,
    modelNotFoundFailuresAfterRecord: modelNotFoundFailures,
    lastFailureSummary: Array.isArray(failuresAfterRecord)
      ? failuresAfterRecord.slice(-3).map((item) => ({
          timestamp: item.timestamp,
          source: item.source,
          selectedModel: item.selectedModel,
          actualModel: item.actualModel,
          upstreamStatus: item.upstreamStatus,
          provider: item.provider,
          requestBodyBytes: item.requestBodyBytes,
          toolCount: item.toolCount,
        }))
      : [],
    probe: record.validation?.probe || null,
  };
}

async function main() {
  const settings = await readJson(SETTINGS);
  const vscode = await readJson(VSCODE_SETTINGS);
  const health = await fetch("http://127.0.0.1:4141/health").then((res) => res.json()).catch((error) => ({ ok: false, error: error.message }));
  const auth = await command("claude", ["auth", "status", "--text"]);
  const type = await command("zsh", ["-lc", "type -a claude"]);
  const cliVersion = await command("claude", ["--version"]);
  const uid = typeof process.getuid === "function" ? process.getuid() : 502;
  const launch = await command("launchctl", ["print", `gui/${uid}/com.codex.openrouter-claude-proxy`]);
  const plist = await plistJson(LAUNCH_AGENT);
  const env = launchAgentEnv(plist);
  const extensions = await extensionVersions();
  const patches = await patchAllExtensions({ log: () => {}, dryRun: true });
  const lastMetrics = await maybeReadJson(LAST_METRICS);
  const recentMetrics = await readJsonlTail(METRICS_LOG, 5);
  const metricsWindow = await readJsonlTail(METRICS_LOG, 500);
  const registry = await maybeReadJson(MODEL_REGISTRY);
  const safeUpdateRecord = await maybeReadJson(LAST_SAFE_UPDATE);
  const trendSource = recentMetrics.length > 0 ? recentMetrics : (lastMetrics ? [lastMetrics] : []);
  const cliVersionNumber = cliVersion.stdout.match(/\d+\.\d+\.\d+/)?.[0] || "unknown";
  const newestExtensionVersion = extensions.map((item) => item.version).sort().at(-1) || "unknown";

  const report = {
    proxyHealth: health,
    upstreamUrl: health.upstream || null,
    launchAgent: {
      path: LAUNCH_AGENT,
      loaded: launch.ok,
      stateLine: launch.stdout.split("\n").find((line) => line.trim().startsWith("state ="))?.trim() || null,
      program: plist?.ProgramArguments || null,
      workingDirectory: plist?.WorkingDirectory || null,
      env,
    },
    cli: {
      path: type.stdout,
      version: cliVersion.stdout,
      authStatus: auth.stdout,
    },
    vscode: {
      settings: {
        useTerminal: vscode["claudeCode.useTerminal"],
        wrapper: vscode["claudeCode.claudeProcessWrapper"],
        disableLoginPrompt: vscode["claudeCode.disableLoginPrompt"],
        preferredLocation: vscode["claudeCode.preferredLocation"],
        extensionsAutoUpdate: vscode["extensions.autoUpdate"],
        extensionsAutoCheckUpdates: vscode["extensions.autoCheckUpdates"],
      },
      extensions,
      cliExtensionVersionMismatch: newestExtensionVersion !== "unknown" && cliVersionNumber !== "unknown" && newestExtensionVersion !== cliVersionNumber,
      extensionPatches: patches.map((patch) => ({
        extension: patch.dir,
        version: patch.version,
        webview: patch.webview.status,
        host: patch.host.status,
        packageJson: patch.packageJson?.status || "not-checked",
      })),
    },
    claudeSettings: {
      baseUrl: settings.env?.ANTHROPIC_BASE_URL,
      authToken: settings.env?.ANTHROPIC_AUTH_TOKEN ? "present-redacted" : "missing",
      apiKeyEmpty: settings.env?.ANTHROPIC_API_KEY === "",
      activeSelectedModel: settings.model ?? "unset",
      opus: settings.env?.ANTHROPIC_DEFAULT_OPUS_MODEL,
      sonnet: settings.env?.ANTHROPIC_DEFAULT_SONNET_MODEL,
      haiku: settings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      custom: settings.env?.ANTHROPIC_CUSTOM_MODEL_OPTION,
      subagent: settings.env?.CLAUDE_CODE_SUBAGENT_MODEL,
      alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
      effortLevel: settings.effortLevel,
      cavemanClaudeCodeEnabled: settings.enabledPlugins?.["caveman@caveman"] === true,
      statusLine: settings.statusLine?.command || null,
    },
    claudeAssets: await listInstalledAssets(settings),
    modelRegistry: summarizeRegistry(registry),
    proxyFeatures: {
      debugTokens: envValue(env, "OPENROUTER_PROXY_DEBUG_TOKENS", "0"),
      promptCache: envValue(env, "OPENROUTER_PROXY_PROMPT_CACHE", "off"),
      pinProvider: envValue(env, "OPENROUTER_PROXY_PIN_PROVIDER", "0"),
      remapInternalHaiku: envValue(env, "OPENROUTER_PROXY_REMAP_INTERNAL_HAIKU", "registry/default"),
      disableTelemetry: settings.env?.DISABLE_TELEMETRY || envValue(env, "DISABLE_TELEMETRY", "0"),
      disableAutoupdater: settings.env?.DISABLE_AUTOUPDATER || envValue(env, "DISABLE_AUTOUPDATER", "0"),
      promptCaching1h: settings.env?.ENABLE_PROMPT_CACHING_1H || envValue(env, "ENABLE_PROMPT_CACHING_1H", "0"),
      experimentalBetasDisabled: settings.env?.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS || envValue(env, "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", "0"),
      retryTransient: envValue(env, "OPENROUTER_PROXY_RETRY_TRANSIENT", "default-on"),
      maxRetries: envValue(env, "OPENROUTER_PROXY_MAX_RETRIES", "1"),
      reasoningPolicy: health.features?.reasoningPolicy || "unknown",
      responseCache: envValue(env, "OPENROUTER_PROXY_RESPONSE_CACHE", "0"),
      budgetStrict: envValue(env, "OPENROUTER_PROXY_BUDGET_STRICT", "0"),
      autoRewrite: "removed-disabled",
      warnContextTokens: envValue(env, "OPENROUTER_PROXY_WARN_CONTEXT_TOKENS", "50000"),
      warnCostUsd: envValue(env, "OPENROUTER_PROXY_WARN_COST_USD", "0.02"),
      wrappers: await wrapperStatus(),
      wrapperEnv: {
        path: CLAUDE_ENV,
        status: await fs.access(CLAUDE_ENV).then(() => "present").catch(() => "missing"),
        injects: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY=", "DISABLE_TELEMETRY", "DISABLE_AUTOUPDATER"],
        optionalInjects: ["ENABLE_PROMPT_CACHING_1H", "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"],
        tokenPrinted: false,
      },
      cleanupPolicy: cleanupPolicySummary(),
    },
    internalHaikuRemap: summarizeInternalHaikuRemap(registry, metricsWindow),
    lastSafeMetrics: safeMetrics(lastMetrics),
    recentRequestSummaries: recentMetrics.map(safeMetrics),
    cacheTrend: cacheTrend(trendSource),
    cacheReadiness: modelCacheReadiness(registry),
    safeUpdate: summarizeSafeUpdate(safeUpdateRecord, cliVersionNumber, metricsWindow),
    updateFreeze: {
      cliAutoUpdaterDisabled: settings.env?.DISABLE_AUTOUPDATER === "1",
      vscodeExtensionAutoUpdateDisabled: vscode["extensions.autoUpdate"] === false,
      vscodeExtensionAutoCheckDisabled: vscode["extensions.autoCheckUpdates"] === false,
      extensionUpdateCommandHidden: patches.every((patch) => String(patch.packageJson?.status || "").includes("update-command")),
      manualSafeUpdateOnly: settings.env?.DISABLE_AUTOUPDATER === "1" && vscode["extensions.autoUpdate"] === false && vscode["extensions.autoCheckUpdates"] === false,
    },
    drift: detectDrift(settings, registry),
    nextActions: nextActionHint({
      drift: detectDrift(settings, registry),
      recentMetrics,
      lastMetrics,
      registry,
    }),
    probe: "not-run; no model calls from doctor unless future --probe is explicitly implemented and invoked",
    claudeDesktop: {
      touchedByThisSetup: false,
      note: "Doctor does not read or modify Claude Desktop settings.",
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
