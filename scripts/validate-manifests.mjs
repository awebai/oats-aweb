#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root holds dev tooling (scripts/, schemas/); the DISTRIBUTED package
// payload lives in the `oats-package/` subtree. Manifests and their resources
// are validated against the payload root; the containment boundary is the
// payload root, never the repo root (contract: repo-only tooling is not
// installed bytes and must never be reachable from a package resource path).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "oats-package");
const errors = [];
const report = (path, message) => errors.push(`${path}: ${message}`);
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { report(relative(root, path), `invalid JSON (${error.message})`); return undefined; }
};

function validateSchema(value, schema, at) {
  if (!schema || typeof schema !== "object") return;
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) report(at, `must be one of ${schema.enum.join(", ")}`);
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type && actual !== schema.type) { report(at, `must be ${schema.type}, got ${actual}`); return; }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) report(at, `must contain at least ${schema.minLength} character(s)`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) report(at, `must match ${schema.pattern}`);
    if (schema.not?.pattern && (new RegExp(schema.not.pattern)).test(value)) report(at, `must not match ${schema.not.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) report(at, `must contain at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) report(at, "must contain unique items");
    value.forEach((item, index) => validateSchema(item, schema.items, `${at}[${index}]`));
  }
  if (value && actual === "object") {
    for (const key of schema.required || []) if (!(key in value)) report(at, `missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames?.pattern && !(new RegExp(schema.propertyNames.pattern)).test(key)) report(`${at}.${key}`, `property name must match ${schema.propertyNames.pattern}`);
      if (properties[key]) validateSchema(item, properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) report(`${at}.${key}`, "unknown property");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchema(item, schema.additionalProperties, `${at}.${key}`);
    }
  }
}

function safeResource(base, candidate, at, kind = "path") {
  if (typeof candidate !== "string" || !candidate.trim()) { report(at, `${kind} must be a non-empty string`); return; }
  if (isAbsolute(candidate) || candidate.split(/[\\/]+/).includes("..")) { report(at, `${kind} must be package-relative and may not contain '..'`); return; }
  const target = resolve(base, candidate);
  if (!existsSync(target)) { report(at, `${kind} does not exist: ${candidate}`); return; }
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) report(at, `${kind} escapes the package root after symlink resolution`);
}

const packagePath = join(root, "oats-package.json");
const packageSchemaPath = join(repoRoot, "schemas", "oats-package.schema.json");
const capabilitySchemaPath = join(repoRoot, "schemas", "capability-manifest.schema.json");
const packageManifest = readJson(packagePath);
const packageSchema = readJson(packageSchemaPath);
const capabilitySchema = readJson(capabilitySchemaPath);

if (packageManifest && packageSchema) validateSchema(packageManifest, packageSchema, "oats-package.json");

const configs = packageManifest?.configs && typeof packageManifest.configs === "object" ? packageManifest.configs : {};
const defaultConfigs = Object.entries(configs).filter(([, spec]) => spec?.default === true);
if (defaultConfigs.length > 1) report("oats-package.json.configs", "at most one config profile may be marked default");
for (const [name, spec] of Object.entries(configs)) {
  if (spec?.path) safeResource(root, spec.path, `oats-package.json.configs.${name}.path`, "config profile");
}

const declaredCapabilities = Array.isArray(packageManifest?.capabilities) ? packageManifest.capabilities : [];
if (declaredCapabilities.length !== 1) {
  report("oats-package.json.capabilities", `official single-capability package must enumerate exactly one capability directory (found ${declaredCapabilities.length})`);
}

const capabilities = [];
for (const [index, capabilityDir] of declaredCapabilities.entries()) {
  safeResource(root, capabilityDir, `oats-package.json.capabilities[${index}]`, "capability directory");
  if (isAbsolute(capabilityDir) || capabilityDir.split(/[\\/]+/).includes("..")) continue;
  const manifestPath = join(root, capabilityDir, "oats.json");
  if (!existsSync(manifestPath)) { report(`oats-package.json.capabilities[${index}]`, `${capabilityDir} has no oats.json`); continue; }
  const manifest = readJson(manifestPath);
  if (!manifest) continue;
  capabilities.push(manifest);
  if (capabilitySchema) validateSchema(manifest, capabilitySchema, `${capabilityDir}/oats.json`);
  const capabilityRoot = dirname(manifestPath);
  for (const [resourceIndex, resource] of (manifest.skills || []).entries()) safeResource(capabilityRoot, resource, `${capabilityDir}/oats.json.skills[${resourceIndex}]`, "skill path");
  if (manifest.inject) safeResource(capabilityRoot, manifest.inject, `${capabilityDir}/oats.json.inject`, "injection path");
  for (const [agentIndex, agent] of (manifest.agents || []).entries()) safeResource(capabilityRoot, agent, `${capabilityDir}/oats.json.agents[${agentIndex}]`, "agent path");
  // A hook may be a plain "entrypoint args" string or the object form
  // { command, required } (only the spawn hook may set required). Commands are
  // always strings. Reduce either to the executable entrypoint for containment.
  const entrypoint = (spec) => {
    const command = typeof spec === "string" ? spec : (spec && typeof spec === "object" ? spec.command : undefined);
    return typeof command === "string" ? command.trim().split(/\s+/)[0] : command;
  };
  for (const [name, command] of Object.entries(manifest.commands || {})) safeResource(capabilityRoot, entrypoint(command), `${capabilityDir}/oats.json.commands.${name}`, "command entrypoint");
  for (const [event, hook] of Object.entries(manifest.hooks || {})) safeResource(capabilityRoot, entrypoint(hook), `${capabilityDir}/oats.json.hooks.${event}`, "hook entrypoint");
  for (const forbidden of ["global", "agent-types", "souls"]) if (forbidden in manifest) report(`${capabilityDir}/oats.json.${forbidden}`, "deployment targeting belongs to config, not a capability manifest");
}

if (capabilities.length === 1 && packageManifest) {
  const capability = capabilities[0];
  if (packageManifest.package === "oats.dev") {
    if (packageManifest.version !== "1.0.0") report("oats-package.json.version", "oats.dev distribution must start at 1.0.0");
    if (capability.capability !== "oats.review" || capability.version !== "1.2.0") {
      report("oats-package.json.capabilities[0]", "oats.dev must export capability oats.review@1.2.0");
    }
  } else {
    if (packageManifest.package !== capability.capability) report("oats-package.json.package", "single-capability official package ID must equal its capability ID");
    if (packageManifest.version !== capability.version) report("oats-package.json.version", "must start at the extracted capability version");
  }
  if (packageManifest.compatibility?.oats !== capability.compatibility?.oats) report("oats-package.json.compatibility.oats", "must match the staged capability compatibility floor");
}

if (errors.length) {
  process.stderr.write(`Manifest validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${relative(process.cwd(), packagePath) || "oats-package.json"} and ${capabilities.length} capability manifest(s).\n`);
