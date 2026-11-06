// aw's JSON answers, read the way aw prints them.
import { leadingJsonObject } from "./aw-failure-cause.mjs";

/** aw's JSON answer: the whole output, or the JSON from the first line that opens it when aw
 *  prints progress before it. A top-level object (one opening at column 0) may also be followed
 *  by notes (`aw workspace status` appends its gone-workspace checks); an indented line is never
 *  taken for the start of the answer, since it can be an object nested inside a cut-off one. */
export const parseAwJson = (text, what) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error(`${what} returned no JSON result`);
  try { return JSON.parse(trimmed); } catch { /* may have progress before JSON or notes after it */ }
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("{")) continue;
    const rest = lines.slice(i).join("\n");
    try { return JSON.parse(rest); } catch { /* not the whole remainder */ }
    if (lines[i].startsWith("{")) { try { return leadingJsonObject(rest); } catch { /* keep looking */ } }
  }
  throw new Error(`${what} returned no JSON result`);
};
