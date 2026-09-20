#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
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

function validateSchema(value, schema, at, rootSchema = schema, references = []) {
  if (!schema || typeof schema !== "object") return;
  // The canonical manifest schema now shares acyclic definitions with local
  // JSON Pointer refs. Evaluate them, never ignore them or copy/fork their
  // protocol rules here. Remote/unresolved/cyclic refs fail validation closed.
  if (Object.hasOwn(schema, "$ref")) {
    const ref = schema.$ref;
    let target = rootSchema;
    if (typeof ref !== "string" || !ref.startsWith("#/") || /~(?![01])/.test(ref) || references.includes(ref) || references.length >= 32) {
      report(at, "unsupported or cyclic schema reference"); return;
    }
    for (const part of ref.slice(2).split("/")) {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      target = target && typeof target === "object" && Object.hasOwn(target, key) ? target[key] : undefined;
    }
    if (!target || typeof target !== "object" || Array.isArray(target)) { report(at, "unresolved schema reference"); return; }
    validateSchema(value, target, at, rootSchema, [...references, ref]);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((alternative) => {
      const start = errors.length;
      validateSchema(value, alternative, at, rootSchema, references);
      return errors.splice(start).length === 0;
    }).length;
    if (matches !== 1) report(at, "must match exactly one schema alternative");
  }
  if ("const" in schema && !Object.is(schema.const, value)) report(at, `must equal ${JSON.stringify(schema.const)}`);
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
    value.forEach((item, index) => validateSchema(item, schema.items, `${at}[${index}]`, rootSchema, references));
  }
  if (value && actual === "object") {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) report(at, `missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames?.pattern && !(new RegExp(schema.propertyNames.pattern)).test(key)) report(`${at}.${key}`, `property name must match ${schema.propertyNames.pattern}`);
      if (Object.hasOwn(properties, key)) validateSchema(item, properties[key], `${at}.${key}`, rootSchema, references);
      else if (schema.additionalProperties === false) report(`${at}.${key}`, "unknown property");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchema(item, schema.additionalProperties, `${at}.${key}`, rootSchema, references);
    }
  }
}

// Check actual installed bytes, including descendants of exported directories.
// Checking just the directory symlink misses a skill, agent or imported module
// that links out to repository-only tooling (or beyond the checkout entirely).
function safeResource(base, candidate, at, kind = "path", { type, recursive = false } = {}) {
  if (typeof candidate !== "string" || !candidate.trim()) { report(at, `${kind} must be a non-empty string`); return; }
  if (isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate) || candidate.includes("\\") || candidate.includes("\0") || candidate.split("/").includes("..")) {
    report(at, `${kind} must be package-relative, use forward slashes and may not contain '..'`); return;
  }
  const realRoot = realpathSync(root);
  const inspect = (path, label, ancestors = new Set(), expectedType) => {
    try {
      const target = realpathSync(path);
      if (target !== realRoot && !target.startsWith(realRoot + sep)) {
        report(label, `${kind} escapes the package root after symlink resolution`); return;
      }
      const stat = statSync(target);
      if ((expectedType === "file" && !stat.isFile()) || (expectedType === "directory" && !stat.isDirectory())) {
        report(label, `${kind} must be a ${expectedType}`); return;
      }
      if (!stat.isFile() && !stat.isDirectory()) { report(label, `${kind} must be a regular file or directory`); return; }
      if (recursive && stat.isDirectory()) {
        if (ancestors.has(target)) { report(label, `${kind} contains a directory symlink cycle`); return; }
        const next = new Set([...ancestors, target]);
        for (const child of readdirSync(target).sort()) inspect(join(target, child), `${label}/${child}`, next);
      }
      return target;
    } catch (error) {
      report(label, `${kind} cannot be resolved: ${error.code || error.message}`);
    }
  };
  return inspect(resolve(base, candidate), at, new Set(), type);
}

// Match the consumer's skillEntriesIn/hasSkillDoc discovery: a leaf SKILL.md
// wins; otherwise only immediate real child directories contribute skills.
// A symlinked child directory is not materialized, even if package-contained.
function validateSkillTree(tree, at) {
  const hasSkillDoc = (dir) => {
    try { return statSync(join(dir, "SKILL.md")).isFile(); } catch { return false; }
  };
  try {
    const skills = hasSkillDoc(tree) ? [tree] : readdirSync(tree, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasSkillDoc(join(tree, entry.name)))
      .map((entry) => join(tree, entry.name));
    if (!skills.length) report(at, "skill tree contains no discoverable skill (requires a regular SKILL.md in the tree or an immediate non-symlink child directory)");
    for (const skill of skills) {
      const doc = safeResource(skill, "SKILL.md", `${at}/${relative(tree, skill) || "."}/SKILL.md`, "skill document", { type: "file" });
      if (doc) readFileSync(doc, "utf8");
    }
  } catch (error) {
    report(at, `skill tree must be readable: ${error.code || error.message}`);
  }
}

const entries = (value) => value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
const array = (value) => Array.isArray(value) ? value : [];

const packagePath = join(root, "oats-package.json");
const packageSchemaPath = join(repoRoot, "schemas", "oats-package.schema.json");
const capabilitySchemaPath = join(repoRoot, "schemas", "capability-manifest.schema.json");
// The root manifest is installed input too: never read it through an escaping
// or dangling symlink, or try to parse a directory/device as JSON.
const safePackagePath = safeResource(root, "oats-package.json", "oats-package.json", "package manifest", { type: "file" });
const packageManifest = safePackagePath ? readJson(safePackagePath) : undefined;
const packageSchema = readJson(packageSchemaPath);
const capabilitySchema = readJson(capabilitySchemaPath);

if (packageManifest && packageSchema) validateSchema(packageManifest, packageSchema, "oats-package.json");

const configs = packageManifest?.configs && typeof packageManifest.configs === "object" ? packageManifest.configs : {};
const defaultConfigs = Object.entries(configs).filter(([, spec]) => spec?.default === true);
if (defaultConfigs.length > 1) report("oats-package.json.configs", "at most one config profile may be marked default");
for (const [name, spec] of Object.entries(configs)) {
  safeResource(root, spec?.path, `oats-package.json.configs.${name}.path`, "config profile", { type: "file" });
}

const declaredCapabilities = Array.isArray(packageManifest?.capabilities) ? packageManifest.capabilities : [];
if (declaredCapabilities.length !== 1) {
  report("oats-package.json.capabilities", `official single-capability package must enumerate exactly one capability directory (found ${declaredCapabilities.length})`);
}

const capabilities = [];
for (const [index, capabilityDir] of declaredCapabilities.entries()) {
  const capabilityRoot = safeResource(root, capabilityDir, `oats-package.json.capabilities[${index}]`, "capability directory", { type: "directory", recursive: true });
  if (!capabilityRoot) continue;
  const manifestPath = safeResource(capabilityRoot, "oats.json", `${capabilityDir}/oats.json`, "capability manifest", { type: "file" });
  if (!manifestPath) continue;
  const manifest = readJson(manifestPath);
  if (capabilitySchema) validateSchema(manifest, capabilitySchema, `${capabilityDir}/oats.json`);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) continue;
  capabilities.push(manifest);
  for (const [resourceIndex, resource] of array(manifest.skills).entries()) {
    const at = `${capabilityDir}/oats.json.skills[${resourceIndex}]`;
    const tree = safeResource(capabilityRoot, resource, at, "skill path", { type: "directory", recursive: true });
    if (tree) validateSkillTree(tree, at);
  }
  if ("inject" in manifest) safeResource(capabilityRoot, manifest.inject, `${capabilityDir}/oats.json.inject`, "injection path", { type: "file" });
  if (manifest.helperInjection?.mode === "file") {
    const at = `${capabilityDir}/oats.json.helperInjection.path`;
    const target = safeResource(capabilityRoot, manifest.helperInjection.path, at, "helper injection path", { type: "file" });
    if (target && !target.startsWith(realpathSync(capabilityRoot) + sep)) report(at, "helper injection must remain inside its owning capability");
  }
  for (const [agentIndex, agent] of array(manifest.agents).entries()) safeResource(capabilityRoot, agent, `${capabilityDir}/oats.json.agents[${agentIndex}]`, "agent path", { type: "directory", recursive: true });
  // A hook may be a plain "entrypoint args" string or the object form
  // { command, required, inputs } (only spawn may require the hook). Commands are
  // always strings. Reduce either to the executable entrypoint for containment.
  const entrypoint = (spec) => {
    const command = typeof spec === "string" ? spec : (spec && typeof spec === "object" ? spec.command : undefined);
    return typeof command === "string" ? command.trim().split(/\s+/)[0] : command;
  };
  for (const [name, command] of entries(manifest.commands)) safeResource(capabilityRoot, entrypoint(command), `${capabilityDir}/oats.json.commands.${name}`, "command entrypoint", { type: "file" });
  for (const [event, hook] of entries(manifest.hooks)) safeResource(capabilityRoot, entrypoint(hook), `${capabilityDir}/oats.json.hooks.${event}`, "hook entrypoint", { type: "file" });
  if (manifest.binding && typeof manifest.binding === "object" && !Array.isArray(manifest.binding)) {
    if (!["knowledge", "messaging", "tasks"].includes(manifest.layer)) report(`${capabilityDir}/oats.json.binding`, "binding codecs require a fundamental capability layer");
    for (const phase of ["normalize", "bind", "check"]) {
      const command = manifest.binding[phase];
      if (typeof command !== "string" || !Object.hasOwn(manifest.commands || {}, command)) report(`${capabilityDir}/oats.json.binding.${phase}`, "must name one of the manifest's commands");
    }
  }
  for (const [name, operation] of entries(manifest.operations)) {
    if (typeof operation?.command !== "string" || !Object.hasOwn(manifest.commands || {}, operation.command)) {
      report(`${capabilityDir}/oats.json.operations.${name}.command`, "must name one of the manifest's commands");
    }
  }
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
    if (packageManifest.version !== capability.version) report("oats-package.json.version", "must match the exported capability version");
  }
  if (packageManifest.compatibility?.oats !== capability.compatibility?.oats) report("oats-package.json.compatibility.oats", "must match the exported capability compatibility floor");
}

if (errors.length) {
  process.stderr.write(`Manifest validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${relative(process.cwd(), packagePath) || "oats-package.json"} and ${capabilities.length} capability manifest(s).\n`);
