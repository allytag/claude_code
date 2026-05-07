#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const ROOT = "__HOME__/.claude/openrouter-claude-proxy";
const REGISTRY = `${ROOT}/model-registry.json`;
const SETTINGS = "__HOME__/.claude/settings.json";
const CLAUDE_ENV = `${ROOT}/claude-env.mjs`;
const CLAUDE_LOW = `${ROOT}/claude-low.mjs`;
const NODE = "__NODE__";
const ROLES = ["main", "cheapFull", "hard", "subagent", "lowToken", "backup", "compare"];

function toolName() {
  const invoked = process.argv[1]?.split("/").pop() || "claude-router";
  return invoked === "or-model" ? "or-model" : "claude-router";
}

function usage(topic = "") {
  const cmd = toolName();
  if (topic === "roles") return helpRoles(cmd);
  if (topic === "workflow") return helpWorkflow(cmd);
  if (topic === "remove") return helpRemove(cmd);
  if (topic === "cleanup") return helpCleanup(cmd);
  if (topic === "examples") return helpExamples(cmd);

  console.log(`Usage:
  ${cmd} list
  ${cmd} status
  ${cmd} tail [--interval 1000]
  ${cmd} resolve <alias|role|model-id>
  ${cmd} add <alias> <openrouter-model-id> [--name "Display Name"] [--as <role>] [--apply] [--dry-run]
  ${cmd} use <role> <alias|model-id> [--dry-run] [--no-apply]
  ${cmd} remove <alias|model-id> [--replace-with <alias|model-id>] [--dry-run] [--no-apply]
  ${cmd} role list
  ${cmd} role set <role> <alias|model-id>
  ${cmd} apply-settings [--dry-run]
  ${cmd} pricing refresh [--dry-run]
  ${cmd} benchmark plan [--models a,b,c] [--suite smoke|cache|tool]
  ${cmd} cache-test plan [--models a,b]
  ${cmd} cleanup [<category>] [--older-than <Nd|Nh>] [--apply]
    Categories: trash | logs | metrics | sessions | shell-snapshots
                old-backups | backups | empty-dirs | file-history
                telemetry | benchmarks | all-safe
    Default is dry-run; pass --apply to actually delete. Default age varies per category.

Guides:
  ${cmd} help roles
  ${cmd} help workflow
  ${cmd} help remove
  ${cmd} help cleanup
  ${cmd} help examples

Wrappers:
  claude-model <alias|model-id> [claude args...]
  claude-role <role> [claude args...]

Alias:
  or-model remains backward-compatible. Preferred name: claude-router.`);
}

function helpRoles(cmd) {
  console.log(`Roles:
  main       Default coding model. Claude slot: sonnet.
  cheapFull  Cheap full Claude Code/background model. Claude slot: haiku.
  hard       Hard reasoning/debugging model. Claude slot: opus.
  subagent   Claude Code subagent model. Settings field: CLAUDE_CODE_SUBAGENT_MODEL.
  lowToken   Explicit claude-low model. No Claude Code tools.
  backup     Manual fallback reserve. Not automatic fallback.
  compare    Custom/alternate test model. Claude custom slot.

Commands:
  ${cmd} status
  ${cmd} use main kimi-k2.6
  ${cmd} use hard deepseek-v4-pro`);
}

function helpWorkflow(cmd) {
  console.log(`Workflow:
  Add model:
    ${cmd} add hy3-preview-free tencent/hy3-preview:free --name "Tencent HY3 Preview Free"

  Try as main and apply settings:
    ${cmd} use main hy3-preview-free

  Switch back:
    ${cmd} use main kimi-k2.6

  Add + set role in one command:
    ${cmd} add hy3-preview-free tencent/hy3-preview:free --name "Tencent HY3 Preview Free" --as main --apply

  Test without changing defaults:
    claude-model hy3-preview-free -p "say ok"

No command above runs model call except claude-model/claude-role/claude-low.`);
}

function helpRemove(cmd) {
  console.log(`Remove:
  Safe remove unused alias:
    ${cmd} remove hy3-preview-free

  If alias used by role, remove refuses:
    Used by roles: main

  Replace role refs then remove:
    ${cmd} remove hy3-preview-free --replace-with kimi-k2.6

Rules:
  - No role left empty.
  - Registry backed up before write.
  - Settings backed up + applied when role refs change.
  - No model calls.
  - --dry-run shows plan only.`);
}

function helpCleanup(cmd) {
  console.log(`Cleanup:
  Dry-run backups:
    ${cmd} cleanup backups --older-than 0d

  Apply after review:
    ${cmd} cleanup backups --older-than 7d --apply

Rules:
  - Dry-run default.
  - Newest backup per source kept.
  - settings.json and settings.json.* backups protected.
  - file-history cleanup deletes only old whole UUID dirs, never partial files.
  - telemetry cleanup only targets failed-event json files.
  - Claude Desktop/plugins/caveman protected.`);
}

function helpExamples(cmd) {
  console.log(`Examples:
  ${cmd} status
  ${cmd} list
  ${cmd} add grok-4 x-ai/grok-4 --name "Grok 4"
  ${cmd} use compare grok-4
  ${cmd} use main kimi-k2.6
  ${cmd} remove hy3-preview-free --replace-with kimi-k2.6
  ${cmd} apply-settings --dry-run
  ${cmd} cleanup backups --older-than 7d --apply`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

async function backup(file, label) {
  const target = `${file}.codex-backup-${stamp()}-${label}`;
  await fs.copyFile(file, target);
  return target;
}

async function loadRegistry() {
  return readJson(REGISTRY);
}

function roleAlias(registry, role) {
  const alias = registry.roles?.[role];
  if (!alias) throw new Error(`Unknown or unassigned role: ${role}`);
  return alias;
}

function findAliasById(registry, id) {
  return Object.entries(registry.models || {}).find(([, model]) => model.id === id)?.[0] || null;
}

function resolveModel(registry, value, { allowRole = true } = {}) {
  if (!value) throw new Error("Missing model alias, role, or OpenRouter model ID");

  if (allowRole && registry.roles?.[value]) {
    const alias = roleAlias(registry, value);
    const model = registry.models?.[alias];
    if (!model) throw new Error(`Role ${value} points to missing alias ${alias}`);
    return { input: value, source: "role", role: value, alias, id: model.id, model };
  }

  if (registry.models?.[value]) {
    const model = registry.models[value];
    return { input: value, source: "alias", alias: value, id: model.id, model };
  }

  const alias = findAliasById(registry, value);
  if (alias) {
    return { input: value, source: "model-id", alias, id: value, model: registry.models[alias] };
  }

  if (value.includes("/")) {
    return {
      input: value,
      source: "direct-model-id",
      alias: null,
      id: value,
      model: {
        id: value,
        displayName: value,
        catalog: {},
        observed: {},
        compatibility: {},
      },
    };
  }

  throw new Error(`Unknown model alias/role/id: ${value}`);
}

function money(value) {
  return typeof value === "number" ? `$${value.toFixed(value >= 1 ? 3 : 6)}` : "unknown";
}

function estimateCost(model, inputTokens, outputTokens) {
  const input = model.catalog?.inputUsdPerMTok;
  const output = model.catalog?.outputUsdPerMTok;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}

function printModelLine(alias, model, roles) {
  const roleText = roles.length ? roles.join(",") : "-";
  const catalog = `${money(model.catalog?.inputUsdPerMTok)}/M in, ${money(model.catalog?.outputUsdPerMTok)}/M out`;
  const observed = model.observed?.latestCostUsd !== null && model.observed?.latestCostUsd !== undefined
    ? `${money(model.observed.latestCostUsd)} via ${model.observed.latestProvider || "unknown"}`
    : "none";
  console.log(`${alias}\n  id: ${model.id}\n  roles: ${roleText}\n  catalog: ${catalog}\n  observed: ${observed}\n  cache: ${model.compatibility?.cacheBehavior || "unknown"}`);
}

function rolesForAlias(registry, alias) {
  return Object.entries(registry.roles || {})
    .filter(([, value]) => value === alias)
    .map(([role]) => role);
}

async function cmdList() {
  const registry = await loadRegistry();
  for (const [alias, model] of Object.entries(registry.models || {})) {
    printModelLine(alias, model, rolesForAlias(registry, alias));
  }
}

async function cmdStatus() {
  const registry = await loadRegistry();
  console.log(`Registry: ${REGISTRY}`);
  console.log(`Updated: ${registry.updatedAt || "unknown"}`);
  console.log("Roles:");
  for (const role of ROLES) {
    const alias = registry.roles?.[role] || "-";
    const id = alias !== "-" ? registry.models?.[alias]?.id || "missing" : "-";
    console.log(`  ${role}: ${alias} -> ${id}`);
  }
  console.log("Claude slots:");
  for (const [slot, role] of Object.entries(registry.claudeSlots || {})) {
    console.log(`  ${slot}: ${role}`);
  }
  if (registry.remaps?.internalHaiku) {
    const cfg = registry.remaps.internalHaiku;
    const targetAlias = registry.roles?.[cfg.targetRole || "cheapFull"];
    const targetId = targetAlias ? registry.models?.[targetAlias]?.id || "missing" : "missing";
    console.log("Remaps:");
    console.log(`  internalHaiku: enabled=${cfg.enabled !== false} targetRole=${cfg.targetRole || "cheapFull"} -> ${targetId}`);
    console.log(`  internalHaiku patterns: ${(cfg.sourceModelPatterns || []).join(", ")}`);
  }
  console.log("Reasoning:");
  for (const [alias, model] of Object.entries(registry.models || {})) {
    if (model.compatibility?.reasoningPassThrough === true) {
      console.log(`  pass-through allowlisted: ${alias} -> ${model.id}`);
    }
  }
  console.log("Cleanup:");
  console.log("  dry-run by default; categories include backups, file-history, telemetry; settings/plugins/Desktop protected");

  const lastMetrics = "__HOME__/.claude/logs/openrouter-claude-proxy-last-metrics.json";
  if (existsSync(lastMetrics)) {
    const metrics = await readJson(lastMetrics);
    console.log("Last metrics:");
    console.log(`  model: ${metrics.actualModel || metrics.selectedModel || "unknown"}`);
    console.log(`  provider: ${metrics.provider || "unknown"}`);
    const inTok = metrics.inputTokens, outTok = metrics.outputTokens;
    const usageReported = (inTok ?? 0) + (outTok ?? 0) > 0 || metrics.cacheReadTokens || metrics.cacheCreationTokens;
    if (!usageReported && (inTok === 0 || inTok === null) && (outTok === 0 || outTok === null)) {
      console.log(`  tokens: provider returned no usage data (in=${inTok ?? "null"} out=${outTok ?? "null"})`);
    } else {
      console.log(`  tokens: in=${inTok ?? "unknown"} out=${outTok ?? "unknown"} cache_create=${metrics.cacheCreationTokens ?? "unknown"} cache_read=${metrics.cacheReadTokens ?? "unknown"}`);
    }
    console.log(`  cost: ${money(metrics.costUsd)} latency_ms=${metrics.latencyMs ?? "unknown"}`);
    if (metrics.promptCache?.applied) {
      console.log(`  prompt_cache: applied at ${(metrics.promptCache.locations || []).join(", ")} (mode=${metrics.promptCache.mode})`);
    } else if (metrics.promptCache?.mode && metrics.promptCache.mode !== "off") {
      console.log(`  prompt_cache: not applied (mode=${metrics.promptCache.mode}, reason=${metrics.promptCache.reason})`);
    }
    if (metrics.providerPin?.applied) {
      console.log(`  provider_pin: ${metrics.providerPin.provider}`);
    }
    if (metrics.modelRemap?.applied) {
      console.log(`  model_remap: ${metrics.modelRemap.from} -> ${metrics.modelRemap.to} (${metrics.modelRemap.reason})`);
    } else if (metrics.modelRemap?.warning) {
      console.log(`  model_remap_warning: ${metrics.modelRemap.warning} (${metrics.modelRemap.from || metrics.selectedModel || "unknown"})`);
    }
    if (metrics.reasoningPolicy) {
      console.log(`  reasoning_policy: ${metrics.reasoningPolicy.action} (${metrics.reasoningPolicy.reason})`);
    }
  } else {
    console.log("Last metrics: none");
  }
}

async function cmdTail(args) {
  const { opts } = parseOptions(args);
  const file = "__HOME__/.claude/logs/openrouter-claude-proxy-last-metrics.json";
  const intervalMs = Number(opts.interval || 1000);
  let lastMtime = 0;
  console.log(`Watching ${file} (poll every ${intervalMs}ms). Ctrl-C to stop.`);
  function fmt(m) {
    const inTok = m.inputTokens, outTok = m.outputTokens;
    const cr = m.cacheReadTokens, cc = m.cacheCreationTokens;
    return `${m.timestamp} ${m.actualModel || m.selectedModel || "?"} via ${m.provider || "?"} | in=${inTok ?? "?"} out=${outTok ?? "?"} cr=${cr ?? "?"} cc=${cc ?? "?"} cost=${money(m.costUsd)} lat=${m.latencyMs ?? "?"}ms${m.warnings?.length ? " warn=" + m.warnings.join(",") : ""}`;
  }
  async function tick() {
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs !== lastMtime) {
        lastMtime = stat.mtimeMs;
        const m = await readJson(file);
        console.log(fmt(m));
      }
    } catch {
      // file may not exist yet
    }
  }
  await tick();
  setInterval(tick, intervalMs);
  await new Promise(() => {}); // hang forever
}

async function cmdCacheTestPlan(args) {
  const { opts } = parseOptions(args);
  const registry = await loadRegistry();
  const modelInputs = (opts.models || "main,cheapFull").split(",").filter(Boolean);
  console.log("Cache-readiness test plan (no model calls run by this command)");
  console.log("Pre-flight:");
  console.log("  1. launchctl setenv OPENROUTER_PROXY_DEBUG_TOKENS 1");
  console.log("  2. launchctl setenv OPENROUTER_PROXY_PROMPT_CACHE auto");
  console.log("  3. (optional) launchctl setenv OPENROUTER_PROXY_PIN_PROVIDER 1");
  console.log("  4. launchctl kickstart -k gui/$(id -u)/com.codex.openrouter-claude-proxy");
  console.log();
  for (const input of modelInputs) {
    const resolved = resolveModel(registry, input);
    const cost1 = estimateCost(resolved.model, 30000, 100);
    const cost2 = estimateCost(resolved.model, 30000, 100);
    console.log(`Model: ${input} -> ${resolved.id}`);
    console.log(`  Turn 1 (cache write): claude --model ${resolved.id} -p "say ok"  // est ${money(cost1)}`);
    console.log(`  Turn 2 (cache read):  claude --model ${resolved.id} -p "say ok again" // est ${money(cost2)}, cache_read should jump`);
    console.log(`  Verify: or-model status   // look for cache_read > 0`);
    console.log();
  }
  console.log("Plan only. Total estimated max cost above. No calls made by this command.");
}

async function cmdResolve(value) {
  const registry = await loadRegistry();
  const resolved = resolveModel(registry, value);
  console.log(resolved.id);
}

function parseOptions(args) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i += 1;
      } else {
        opts[key] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { opts, rest };
}

async function saveRegistry(registry, dryRun = false, label = "modelregistry") {
  registry.updatedAt = new Date().toISOString().slice(0, 10);
  if (dryRun) {
    console.log(JSON.stringify(registry, null, 2));
    return null;
  }
  const backupPath = await backup(REGISTRY, label);
  await writeJson(REGISTRY, registry);
  return backupPath;
}

function redactedSettings(settings) {
  const redacted = structuredClone(settings);
  if (redacted.env?.ANTHROPIC_AUTH_TOKEN) redacted.env.ANTHROPIC_AUTH_TOKEN = "<REDACTED>";
  return redacted;
}

async function applySettingsFromRegistry(registry, { dryRun = false, label = "modelregistry", print = true } = {}) {
  const next = await buildSettingsFromRegistry(registry);
  if (dryRun) {
    if (print) console.log(JSON.stringify(redactedSettings(next), null, 2));
    return null;
  }
  const backupPath = await backup(SETTINGS, label);
  await writeJson(SETTINGS, next);
  return backupPath;
}

async function cmdAdd(args) {
  const { opts, rest } = parseOptions(args);
  const [alias, id] = rest;
  if (!alias || !id) throw new Error("Usage: claude-router add <alias> <openrouter-model-id> [--name Display] [--as role] [--apply] [--dry-run]");
  const registry = await loadRegistry();
  if (registry.models?.[alias]) throw new Error(`Alias already exists: ${alias}`);
  if (opts.as && !ROLES.includes(opts.as)) throw new Error(`Invalid role for --as: ${opts.as}`);
  registry.models ||= {};
  registry.models[alias] = {
    id,
    displayName: opts.name || alias,
    description: "Added locally. Catalog pricing unknown until pricing refresh or manual update.",
    catalog: {
      source: "unknown",
      checkedAt: null,
      contextTokens: null,
      inputUsdPerMTok: null,
      outputUsdPerMTok: null,
      cacheWriteUsdPerMTok: null,
      cacheReadUsdPerMTok: null,
    },
    observed: {
      source: "none",
      updatedAt: null,
      sampleCount: 0,
      latestProvider: null,
      latestInputTokens: null,
      latestOutputTokens: null,
      latestCacheCreationTokens: null,
      latestCacheReadTokens: null,
      latestCostUsd: null,
      effectiveInputUsdPerMTok: null,
      notes: "No local request observed yet.",
    },
    compatibility: {
      toolUse: "needs-real-test",
      fileEdit: "needs-real-test",
      streaming: "needs-real-test",
      cacheBehavior: "needs-real-test",
    },
  };
  if (opts.as) registry.roles[opts.as] = alias;

  if (opts["dry-run"]) {
    console.log(`Would add ${alias} -> ${id}`);
    if (opts.as) console.log(`Would set role ${opts.as} -> ${alias}`);
    if (opts.apply) {
      console.log("Would apply Claude settings:");
      await applySettingsFromRegistry(registry, { dryRun: true });
    }
    return;
  }

  const backupPath = await saveRegistry(registry, false, "modeladd");
  console.log(`Added ${alias} -> ${id}`);
  if (opts.as) console.log(`Role ${opts.as} -> ${alias}`);
  console.log(`Registry backup: ${backupPath}`);
  if (opts.apply) {
    const settingsBackup = await applySettingsFromRegistry(registry, { label: "modeladd" });
    console.log(`Settings backup: ${settingsBackup}`);
  } else if (opts.as) {
    console.log("Settings not applied. Run: claude-router apply-settings");
  }
  console.log("No model call run.");
}

async function cmdRole(args) {
  const [sub, role, value] = args;
  const registry = await loadRegistry();
  if (sub === "list" || !sub) {
    for (const roleName of ROLES) {
      const alias = registry.roles?.[roleName] || "-";
      console.log(`${roleName}: ${alias}`);
    }
    return;
  }
  if (sub !== "set" || !role || !value) throw new Error("Usage: or-model role set <role> <alias|model-id>");
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const resolved = resolveModel(registry, value, { allowRole: false });
  if (!resolved.alias) throw new Error("Assign role to registry alias first. Use or-model add <alias> <model-id>.");
  registry.roles[role] = resolved.alias;
  const backupPath = await saveRegistry(registry);
  console.log(`Role ${role} -> ${resolved.alias} (${resolved.id})\nBackup: ${backupPath}`);
}

function envFieldForSlot(slot) {
  if (slot === "sonnet") return ["ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION"];
  if (slot === "haiku") return ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION"];
  if (slot === "opus") return ["ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION"];
  if (slot === "custom") return ["ANTHROPIC_CUSTOM_MODEL_OPTION", "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME", "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"];
  throw new Error(`Unsupported Claude slot: ${slot}`);
}

async function buildSettingsFromRegistry(registry) {
  const settings = await readJson(SETTINGS);
  settings.env ||= {};
  const slotMap = registry.claudeSlots || {};
  for (const slot of ["sonnet", "haiku", "opus", "custom"]) {
    const role = slotMap[slot];
    const alias = roleAlias(registry, role);
    const model = registry.models[alias];
    if (!model) throw new Error(`Missing model for role ${role}: ${alias}`);
    const [idField, nameField, descField] = envFieldForSlot(slot);
    settings.env[idField] = model.id;
    settings.env[nameField] = model.displayName || alias;
    settings.env[descField] = model.description || `${role} role`;
  }

  const subagentAlias = roleAlias(registry, slotMap.subagent || "subagent");
  settings.env.CLAUDE_CODE_SUBAGENT_MODEL = registry.models[subagentAlias]?.id || subagentAlias;
  settings.model = slotMap.defaultSlot || "sonnet";
  return settings;
}

async function cmdApplySettings(args) {
  const { opts } = parseOptions(args);
  const registry = await loadRegistry();
  const backupPath = await applySettingsFromRegistry(registry, { dryRun: Boolean(opts["dry-run"]), label: "modelregistry" });
  if (backupPath) console.log(`Updated ${SETTINGS}\nBackup: ${backupPath}`);
}

async function cmdUse(args) {
  const { opts, rest } = parseOptions(args);
  const [role, value] = rest;
  if (!role || !value) throw new Error("Usage: claude-router use <role> <alias|model-id> [--dry-run] [--no-apply]");
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const registry = await loadRegistry();
  const resolved = resolveModel(registry, value, { allowRole: false });
  if (!resolved.alias) throw new Error("Role target must be a registry alias/model ID already in registry. Add it first with claude-router add.");
  const previous = registry.roles?.[role] || null;
  registry.roles ||= {};
  registry.roles[role] = resolved.alias;

  const apply = !opts["no-apply"];
  if (opts["dry-run"]) {
    console.log(`Would set ${role}: ${previous || "-"} -> ${resolved.alias} (${resolved.id})`);
    if (apply) {
      console.log("Would apply Claude settings:");
      await applySettingsFromRegistry(registry, { dryRun: true });
    } else {
      console.log("Would not apply Claude settings (--no-apply).");
    }
    return;
  }

  const registryBackup = await saveRegistry(registry, false, "roleuse");
  let settingsBackup = null;
  if (apply) settingsBackup = await applySettingsFromRegistry(registry, { label: "roleuse" });
  console.log(`Set ${role}: ${previous || "-"} -> ${resolved.alias} (${resolved.id})`);
  console.log(`Registry backup: ${registryBackup}`);
  if (settingsBackup) console.log(`Settings backup: ${settingsBackup}`);
  if (!apply) console.log("Settings not applied. Run: claude-router apply-settings");
  console.log("No model call run.");
}

async function cmdRemove(args) {
  const { opts, rest } = parseOptions(args);
  const [value] = rest;
  if (!value) throw new Error("Usage: claude-router remove <alias|model-id> [--replace-with <alias|model-id>] [--dry-run] [--no-apply]");
  if (opts.force && !opts["replace-with"]) throw new Error("--force without --replace-with is not allowed. No role may be left empty.");

  const registry = await loadRegistry();
  const resolved = resolveModel(registry, value, { allowRole: false });
  if (!resolved.alias) throw new Error(`Not a registry model alias/id: ${value}`);
  const alias = resolved.alias;
  const usedRoles = Object.entries(registry.roles || {})
    .filter(([, roleAliasValue]) => roleAliasValue === alias)
    .map(([role]) => role);

  let replacement = null;
  if (opts["replace-with"]) {
    replacement = resolveModel(registry, opts["replace-with"], { allowRole: false });
    if (!replacement.alias) throw new Error("--replace-with must point to existing registry alias/model ID. Add replacement first.");
    if (replacement.alias === alias) throw new Error("--replace-with cannot be same model being removed.");
  }

  if (usedRoles.length > 0 && !replacement) {
    throw new Error(`Cannot remove ${alias}. Used by roles: ${usedRoles.join(", ")}. Run: claude-router remove ${alias} --replace-with kimi-k2.6`);
  }

  if (opts["dry-run"]) {
    console.log(`Would remove ${alias} -> ${resolved.id}`);
    if (usedRoles.length > 0) {
      console.log(`Would move roles ${usedRoles.join(", ")} -> ${replacement.alias} (${replacement.id})`);
      if (!opts["no-apply"]) {
        const preview = structuredClone(registry);
        for (const role of usedRoles) preview.roles[role] = replacement.alias;
        delete preview.models[alias];
        console.log("Would apply Claude settings:");
        await applySettingsFromRegistry(preview, { dryRun: true });
      }
    }
    console.log("No files changed.");
    return;
  }

  for (const role of usedRoles) registry.roles[role] = replacement.alias;
  delete registry.models[alias];

  const registryBackup = await saveRegistry(registry, false, "modelremove");
  let settingsBackup = null;
  const shouldApply = usedRoles.length > 0 && !opts["no-apply"];
  if (shouldApply) settingsBackup = await applySettingsFromRegistry(registry, { label: "modelremove" });

  console.log(`Removed ${alias} -> ${resolved.id}`);
  if (usedRoles.length > 0) console.log(`Moved roles ${usedRoles.join(", ")} -> ${replacement.alias} (${replacement.id})`);
  console.log(`Registry backup: ${registryBackup}`);
  if (settingsBackup) console.log(`Settings backup: ${settingsBackup}`);
  if (usedRoles.length > 0 && !settingsBackup) console.log("Settings not applied. Run: claude-router apply-settings");
  console.log("No model call run.");
}

async function cmdPricing(args) {
  const [sub, ...rest] = args;
  if (sub !== "refresh") throw new Error("Usage: or-model pricing refresh [--dry-run]");
  const { opts } = parseOptions(rest);
  const registry = await loadRegistry();
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`OpenRouter models fetch failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const byId = new Map((data.data || []).map((model) => [model.id, model]));
  for (const model of Object.values(registry.models || {})) {
    const remote = byId.get(model.id);
    if (!remote) continue;
    const pricing = remote.pricing || {};
    model.catalog ||= {};
    model.catalog.source = "openrouter-api";
    model.catalog.checkedAt = new Date().toISOString();
    model.catalog.contextTokens = remote.context_length ?? model.catalog.contextTokens ?? null;
    model.catalog.inputUsdPerMTok = pricing.prompt !== undefined ? Number(pricing.prompt) * 1_000_000 : model.catalog.inputUsdPerMTok ?? null;
    model.catalog.outputUsdPerMTok = pricing.completion !== undefined ? Number(pricing.completion) * 1_000_000 : model.catalog.outputUsdPerMTok ?? null;
    model.catalog.cacheWriteUsdPerMTok = pricing.input_cache_write !== undefined ? Number(pricing.input_cache_write) * 1_000_000 : model.catalog.cacheWriteUsdPerMTok ?? null;
    model.catalog.cacheReadUsdPerMTok = pricing.input_cache_read !== undefined ? Number(pricing.input_cache_read) * 1_000_000 : model.catalog.cacheReadUsdPerMTok ?? null;
  }
  const backupPath = await saveRegistry(registry, Boolean(opts["dry-run"]));
  if (backupPath) console.log(`Pricing refreshed\nBackup: ${backupPath}`);
}

async function cmdBenchmarkPlan(args) {
  const { opts } = parseOptions(args);
  const registry = await loadRegistry();
  const suiteName = opts.suite || "smoke";
  const suite = registry.benchmarkSuites?.[suiteName];
  if (!suite) throw new Error(`Unknown suite: ${suiteName}`);
  const modelInputs = (opts.models || Object.values(registry.roles).join(",")).split(",").filter(Boolean);
  const uniqueIds = [...new Set(modelInputs)];
  let total = 0;
  console.log(`Suite: ${suiteName}`);
  console.log(suite.description);
  for (const input of uniqueIds) {
    const resolved = resolveModel(registry, input);
    const cost = estimateCost(resolved.model, suite.estimatedFullModeInputTokens, suite.estimatedOutputTokens);
    if (typeof cost === "number") total += cost;
    console.log(`- ${input} -> ${resolved.id}: est ${money(cost)} (${suite.estimatedFullModeInputTokens} in, ${suite.estimatedOutputTokens} out)`);
  }
  console.log(`Estimated catalog max: ${money(total)}`);
  console.log("Plan only. No model calls run.");
}

function execCommand(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

// =================================================================================================
// CLEANUP SUBSYSTEM
// =================================================================================================
// Hard-protected paths. The cleanup tool will refuse to touch any of these regardless of category.
// Anything Claude Desktop, Anthropic Desktop config, Library Application Support (other than the
// VS Code patch backups which are explicitly handled), unrelated projects, settings, registry,
// proxy runtime, LaunchAgent, current docs, current backups, and rollback files.
const CLEANUP_PROTECTED = new Set([
  "__HOME__/.claude/settings.json",
  "__HOME__/.claude/openrouter-claude-proxy/server.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/doctor.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/modelctl.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/patch-extension.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/claude-low.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/claude-env.mjs",
  "__HOME__/.claude/openrouter-claude-proxy/model-registry.json",
  "__HOME__/.claude/openrouter-claude-proxy/package.json",
  "__HOME__/.claude/openrouter-claude-proxy/README.md",
  "__HOME__/.claude/OPENROUTER_CLAUDE_CODE_SETUP.md",
  "__HOME__/.claude/logs/openrouter-claude-proxy.log",
  "__HOME__/.claude/logs/openrouter-claude-proxy.err.log",
  "__HOME__/.claude/logs/openrouter-claude-proxy-last-metrics.json",
  "__HOME__/.claude/logs/openrouter-claude-proxy-metrics.jsonl",
  "__HOME__/Library/LaunchAgents/com.codex.openrouter-claude-proxy.plist",
]);

// Directory prefixes that the cleanup tool refuses to descend into for any category.
// Caveman plugin and Claude Desktop are explicitly listed and tested.
const CLEANUP_FORBIDDEN_PREFIXES = [
  "__HOME__/Library/Application Support/Claude",            // Claude Desktop
  "__HOME__/Library/Application Support/com.anthropic.claudefordesktop",
  "__HOME__/.claude/plugins",                                // user plugins
  "__HOME__/.claude/plugins/cache/caveman",                  // explicit caveman cache guard
  "__HOME__/.claude/plugins/marketplaces/caveman",           // explicit caveman marketplace guard
  "__HOME__/plugins/caveman",                                // user-installed caveman source
  "__HOME__/.claude/openrouter-claude-proxy",                // proxy code/registry/docs
  "__HOME__/.vscode/extensions/anthropic.claude-code-",      // extension folders themselves
];

function isProtectedPath(p) {
  if (CLEANUP_PROTECTED.has(p)) return true;
  if (p.startsWith("__HOME__/.claude/settings.json.")) return true;
  if (p.includes("/Claude Desktop") || p.includes("/Application Support/Claude")) return true;
  for (const prefix of CLEANUP_FORBIDDEN_PREFIXES) {
    if (p.startsWith(prefix) && !p.includes(".opus-trash-")) {
      // The proxy dir prefix is forbidden as a tree, but cleanup of old codex-backup-* and opus-backup-* files
      // inside it is handled by the explicit "old-backups" category which whitelists exact filenames.
      // The protection here prevents recursive deletion of the proxy directory itself.
      if (prefix === "__HOME__/.claude/openrouter-claude-proxy") {
        // Allow *.codex-backup-*, *.opus-backup-*, *.opus-trash-* files inside the proxy dir to be cleanup-eligible
        // when explicitly enumerated by the old-backups category.
        return false;
      }
      return true;
    }
  }
  return false;
}

function parseAge(value) {
  // Returns ms. Supports "Nd" / "Nh" / "Nm" / plain number = days.
  if (!value) return null;
  const m = String(value).match(/^(\d+)([dhms]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "d";
  const factor = unit === "d" ? 86400_000 : unit === "h" ? 3600_000 : unit === "m" ? 60_000 : 1000;
  return n * factor;
}

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function listFiles(dir, predicate) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (predicate(entry, full)) out.push(full);
  }
  return out;
}

async function fmtCandidate(p) {
  const s = await statSafe(p);
  const size = s?.isDirectory() ? await recursiveSize(p) : (s ? s.size : 0);
  const latest = s?.isDirectory() ? await newestMtimeMs(p) : (s?.mtimeMs || 0);
  const ageMs = latest ? Date.now() - latest : 0;
  const ageDays = Math.floor(ageMs / 86400_000);
  return { path: p, sizeBytes: size, ageDays };
}

async function recursiveSize(p) {
  const s = await statSafe(p);
  if (!s) return 0;
  if (!s.isDirectory()) return s.size;
  let total = 0;
  let entries = [];
  try {
    entries = await fs.readdir(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    total += await recursiveSize(`${p}/${entry.name}`);
  }
  return total;
}

async function newestMtimeMs(p) {
  const s = await statSafe(p);
  if (!s) return 0;
  let newest = s.mtimeMs;
  if (!s.isDirectory()) return newest;
  let entries = [];
  try {
    entries = await fs.readdir(p, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    newest = Math.max(newest, await newestMtimeMs(`${p}/${entry.name}`));
  }
  return newest;
}

function humanBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}G`;
}

const CLEANUP_DEFAULTS = {
  trash: 0,             // any age
  logs: 14,             // days
  metrics: 14,
  sessions: 30,
  "shell-snapshots": 14,
  "old-backups": 30,
  "empty-dirs": 0,
  "file-history": 30,
  telemetry: 14,
  benchmarks: 1,
};

const CLEANUP_CATEGORIES = Object.keys(CLEANUP_DEFAULTS);

// Each builder returns an array of absolute paths to delete. Builders must already filter by age.
// Builders MUST NOT return any path inside CLEANUP_PROTECTED or CLEANUP_FORBIDDEN_PREFIXES.
async function buildTrash(olderMs) {
  const now = Date.now();
  const found = [];
  // .opus-trash-* anywhere in known dirs
  const dirs = [
    "__HOME__/.claude/logs",
    "__HOME__/.claude/openrouter-claude-proxy",
    "__HOME__/.claude",
  ];
  for (const dir of dirs) {
    const items = await listFiles(dir, (e) => e.isFile() && e.name.includes(".opus-trash-"));
    for (const p of items) {
      if (isProtectedPath(p)) continue;
      const s = await statSafe(p);
      if (!s) continue;
      if (now - s.mtimeMs >= olderMs) found.push(p);
    }
  }
  return found;
}

async function buildLogs(olderMs) {
  // Rotate compressed/old proxy log artifacts. Current log files themselves are protected.
  // Currently nothing matches outside protected; reserve for future log rotation.
  return [];
}

async function buildMetrics(olderMs) {
  // Truncate-style cleanup: copy current jsonl to .archive-<stamp>.jsonl when it's older than threshold,
  // then delete originals older than threshold. Today: only return JSONL archive files older than threshold.
  const dir = "__HOME__/.claude/logs";
  const now = Date.now();
  const items = await listFiles(dir, (e) => e.isFile() && /-metrics\.jsonl\.archive-/.test(e.name));
  const found = [];
  for (const p of items) {
    if (isProtectedPath(p)) continue;
    const s = await statSafe(p);
    if (!s) continue;
    if (now - s.mtimeMs >= olderMs) found.push(p);
  }
  return found;
}

async function buildSessions(olderMs) {
  // ~/.claude/projects/*/<uuid>.jsonl — Claude Code session histories.
  // Only target old ones, never the current open ones.
  const root = "__HOME__/.claude/projects";
  const now = Date.now();
  let projectDirs;
  try {
    projectDirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const d of projectDirs) {
    if (!d.isDirectory()) continue;
    const projDir = `${root}/${d.name}`;
    const sessions = await listFiles(projDir, (e) => e.isFile() && e.name.endsWith(".jsonl"));
    for (const p of sessions) {
      if (isProtectedPath(p)) continue;
      const s = await statSafe(p);
      if (!s) continue;
      if (now - s.mtimeMs >= olderMs) found.push(p);
    }
  }
  return found;
}

async function buildShellSnapshots(olderMs) {
  const dir = "__HOME__/.claude/shell-snapshots";
  const now = Date.now();
  const items = await listFiles(dir, (e) => e.isFile() && e.name.startsWith("snapshot-"));
  const found = [];
  for (const p of items) {
    if (isProtectedPath(p)) continue;
    const s = await statSafe(p);
    if (!s) continue;
    if (now - s.mtimeMs >= olderMs) found.push(p);
  }
  return found;
}

async function buildOldBackups(olderMs) {
  // Old codex/opus backup files inside proxy dir, settings.json backups, setup doc backups,
  // and wrapper backups. Keeps the most recent 1 per category as a safety net.
  const now = Date.now();
  const candidateGlobs = [
    { dir: "__HOME__/.claude/openrouter-claude-proxy", re: /\.(codex-backup-[\w-]+|opus-backup-[\w-]+)$/ },
    { dir: "__HOME__/.claude", re: /\.(codex-backup-[\w-]+|opus-backup-[\w-]+|bak)$/ },
    { dir: "__HOME__/.local/bin", re: /\.opus-backup-[\w-]+$/ },
  ];
  const all = [];
  for (const { dir, re } of candidateGlobs) {
    const items = await listFiles(dir, (e) => e.isFile() && re.test(e.name));
    for (const p of items) all.push(p);
  }
  // Group by source file (everything before .codex-backup / .opus-backup / .bak).
  const groups = new Map();
  for (const p of all) {
    const base = p.replace(/\.(codex-backup-[\w-]+|opus-backup-[\w-]+|bak)$/, "");
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }
  const found = [];
  for (const [, list] of groups) {
    // Keep the most-recent backup per source file. Mark the rest eligible if older than threshold.
    const withStat = await Promise.all(list.map(async (p) => ({ p, s: await statSafe(p) })));
    withStat.sort((a, b) => (b.s?.mtimeMs || 0) - (a.s?.mtimeMs || 0));
    const keep = withStat[0]?.p;
    for (const { p, s } of withStat) {
      if (p === keep) continue;
      if (isProtectedPath(p)) continue;
      if (!s) continue;
      if (now - s.mtimeMs >= olderMs) found.push(p);
    }
  }
  return found;
}

async function buildEmptyDirs(olderMs) {
  // file-history empty UUID dirs, session-env, downloads if empty
  const candidates = [
    "__HOME__/.claude/file-history",
    "__HOME__/.claude/session-env",
    "__HOME__/.claude/downloads",
  ];
  const found = [];
  for (const dir of candidates) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = `${dir}/${e.name}`;
      try {
        const inner = await fs.readdir(sub);
        if (inner.length === 0) {
          if (!isProtectedPath(sub)) found.push(sub);
        }
      } catch {}
    }
  }
  return found;
}

async function buildFileHistory(olderMs) {
  // Claude Code file-history can store file content snapshots. Delete only whole UUID dirs older
  // than threshold by newest descendant mtime; never delete individual files from a live dir.
  const root = "__HOME__/.claude/file-history";
  const now = Date.now();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = `${root}/${entry.name}`;
    if (isProtectedPath(dir)) continue;
    dirs.push({ dir, newest: await newestMtimeMs(dir) });
  }
  dirs.sort((a, b) => b.newest - a.newest);
  const keepNewest = dirs[0]?.dir;

  return dirs
    .filter(({ dir, newest }) => dir !== keepNewest && now - newest >= olderMs)
    .map(({ dir }) => dir);
}

async function buildTelemetry(olderMs) {
  // Only Claude Code failed telemetry spool files. No broad telemetry directory deletion.
  const dir = "__HOME__/.claude/telemetry";
  const now = Date.now();
  const items = await listFiles(dir, (e) => e.isFile() && /^1p_failed_events\..+\.json$/.test(e.name));
  const found = [];
  for (const p of items) {
    if (isProtectedPath(p)) continue;
    const s = await statSafe(p);
    if (!s) continue;
    if (now - s.mtimeMs >= olderMs) found.push(p);
  }
  return found;
}

async function buildBenchmarks(olderMs) {
  // Anything in /tmp/or-bench-* and /tmp/claude-cache-test-*
  const tmp = "/tmp";
  const now = Date.now();
  const items = await listFiles(tmp, (e) => (e.isDirectory() || e.isFile()) && /^(or-bench-|claude-cache-test-)/.test(e.name));
  const found = [];
  for (const p of items) {
    const s = await statSafe(p);
    if (!s) continue;
    if (now - s.mtimeMs >= olderMs) found.push(p);
  }
  return found;
}

const CLEANUP_BUILDERS = {
  trash: buildTrash,
  logs: buildLogs,
  metrics: buildMetrics,
  sessions: buildSessions,
  "shell-snapshots": buildShellSnapshots,
  "old-backups": buildOldBackups,
  "empty-dirs": buildEmptyDirs,
  "file-history": buildFileHistory,
  telemetry: buildTelemetry,
  benchmarks: buildBenchmarks,
};

async function cmdCleanup(args) {
  const { opts, rest } = parseOptions(args);
  const category = rest[0] === "backups" ? "old-backups" : rest[0];
  const requested = (category && category !== "all-safe")
    ? [category]
    : (category === "all-safe"
      ? CLEANUP_CATEGORIES
      : ["trash", "old-backups", "empty-dirs", "file-history", "telemetry", "benchmarks"]);
  const apply = Boolean(opts.apply);

  for (const cat of requested) {
    if (!CLEANUP_CATEGORIES.includes(cat)) {
      throw new Error(`Unknown cleanup category: ${cat}. Known: ${CLEANUP_CATEGORIES.join(", ")}`);
    }
  }

  let totalSize = 0;
  let totalCount = 0;
  const summary = {};

  for (const cat of requested) {
    const ageStr = opts["older-than"] || `${CLEANUP_DEFAULTS[cat]}d`;
    const olderMs = parseAge(ageStr) ?? CLEANUP_DEFAULTS[cat] * 86400_000;
    const candidates = await CLEANUP_BUILDERS[cat](olderMs);
    const safe = candidates.filter((p) => !isProtectedPath(p));
    const records = await Promise.all(safe.map(fmtCandidate));
    summary[cat] = records;
    let cs = 0;
    for (const r of records) cs += r.sizeBytes;
    totalSize += cs;
    totalCount += records.length;
  }

  console.log(`Cleanup ${apply ? "APPLY" : "DRY-RUN"} (default: dry-run)`);
  console.log("Categories:", requested.join(", "));
  console.log();
  for (const [cat, records] of Object.entries(summary)) {
    if (records.length === 0) {
      console.log(`[${cat}] no candidates`);
      continue;
    }
    let cs = 0;
    for (const r of records) cs += r.sizeBytes;
    console.log(`[${cat}] ${records.length} candidate(s), ${humanBytes(cs)}`);
    for (const r of records.slice(0, 50)) {
      console.log(`  ${humanBytes(r.sizeBytes).padStart(8)}  ${String(r.ageDays).padStart(3)}d  ${r.path}`);
    }
    if (records.length > 50) console.log(`  ... and ${records.length - 50} more`);
  }
  console.log();
  console.log(`Total: ${totalCount} item(s), ${humanBytes(totalSize)}`);

  if (!apply) {
    console.log();
    console.log("This was a dry-run. To actually delete, re-run with --apply.");
    console.log("Always-protected items (settings, registry, current docs/logs/metrics, LaunchAgent, plugins, Claude Desktop, extension folders) are never listed.");
    return;
  }

  // Apply
  let deleted = 0;
  let bytesFreed = 0;
  const errors = [];
  for (const records of Object.values(summary)) {
    for (const r of records) {
      if (isProtectedPath(r.path)) continue; // double-check
      try {
        const s = await statSafe(r.path);
        if (!s) continue;
        if (s.isDirectory()) {
          await fs.rm(r.path, { recursive: true, force: false });
        } else {
          await fs.unlink(r.path);
        }
        deleted += 1;
        bytesFreed += r.sizeBytes;
      } catch (error) {
        errors.push(`${r.path}: ${error.message}`);
      }
    }
  }
  console.log(`Deleted ${deleted} item(s), freed ${humanBytes(bytesFreed)}`);
  if (errors.length > 0) {
    console.log(`${errors.length} error(s):`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
  }
}

async function cmdExecModel(args) {
  const [modelInput, ...rest] = args;
  const registry = await loadRegistry();
  const resolved = resolveModel(registry, modelInput);
  execCommand(NODE, [CLAUDE_ENV, "--model", resolved.id, ...rest]);
}

async function cmdExecRole(args) {
  const [role, ...rest] = args;
  if (!role) throw new Error("Usage: claude-role <role> [args...]");
  const registry = await loadRegistry();
  const resolved = resolveModel(registry, role);
  if (role === "lowToken") {
    execCommand(NODE, [CLAUDE_LOW, "--model", resolved.id, ...rest]);
    return;
  }
  execCommand(NODE, [CLAUDE_ENV, "--model", resolved.id, ...rest]);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage(args[0] || "");
    return;
  }
  if (cmd === "list") return cmdList();
  if (cmd === "status") return cmdStatus();
  if (cmd === "tail") return cmdTail(args);
  if (cmd === "resolve") return cmdResolve(args[0]);
  if (cmd === "add") return cmdAdd(args);
  if (cmd === "use") return cmdUse(args);
  if (cmd === "remove") return cmdRemove(args);
  if (cmd === "role") return cmdRole(args);
  if (cmd === "apply-settings") return cmdApplySettings(args);
  if (cmd === "pricing") return cmdPricing(args);
  if (cmd === "benchmark" && args[0] === "plan") return cmdBenchmarkPlan(args.slice(1));
  if (cmd === "cache-test" && args[0] === "plan") return cmdCacheTestPlan(args.slice(1));
  if (cmd === "cleanup") return cmdCleanup(args);
  if (cmd === "exec-model") return cmdExecModel(args);
  if (cmd === "exec-role") return cmdExecRole(args);
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((error) => {
  console.error(`${toolName()} error: ${error.message}`);
  process.exit(1);
});
