// OATS_SETTINGS is kernel-supplied JSON. Keep parser diagnostics fixed: the
// document can contain credentials and must never appear in an error envelope.
export function parseProviderSettings(env = process.env) {
  try { return JSON.parse(env.OATS_SETTINGS ?? "{}"); }
  catch { throw new Error("OATS_SETTINGS must be valid JSON"); }
}
