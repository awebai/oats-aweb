// Commands that need a newer aw than the provider's floor are cited inside
// marked sections, so the real-aw doc checks can tell them from the rest:
//
//   <!-- aw-min 1.36.53 -->  …  <!-- /aw-min -->     (Markdown)
//   // aw-min 1.36.53        …  // /aw-min           (JavaScript)
//
// Text outside every marker is always checked. A marker stands alone on its
// line; one that is inline, unclosed, nested, unopened or has no version
// refuses, so a typo can't widen a gate or drop the text beside it.
const OPEN = /^\s*(?:<!--|\/\/)\s*aw-min(?:\s+(\S+?))?\s*(?:-->)?\s*$/;
const CLOSE = /^\s*(?:<!--|\/\/)\s*\/aw-min\s*(?:-->)?\s*$/;
const ANY_MARKER = /(?:<!--|\/\/)\s*\/?aw-min\b/;

/** {ungated, gated: [{min, text}]}: `ungated` is the text outside every
 *  marked section, each `gated` entry one section's text and its version. */
export function splitByAwMin(text) {
  const ungated = [], gated = [];
  let open = null;
  for (const [i, line] of text.split("\n").entries()) {
    if (ANY_MARKER.test(line) && !OPEN.test(line) && !CLOSE.test(line)) throw new Error(`line ${i + 1}: an aw-min marker must stand alone on its line`);
    if (CLOSE.test(line)) {
      if (!open) throw new Error(`line ${i + 1}: /aw-min closes no aw-min section`);
      gated.push({ min: open.min, text: open.lines.join("\n") });
      open = null;
      continue;
    }
    const m = OPEN.exec(line);
    if (m) {
      if (open) throw new Error(`line ${i + 1}: aw-min sections don't nest (one opened at line ${open.at})`);
      if (!/^\d+\.\d+\.\d+$/.test(m[1] || "")) throw new Error(`line ${i + 1}: aw-min needs a version, like aw-min 1.36.53`);
      open = { min: m[1], at: i + 1, lines: [] };
      continue;
    }
    (open ? open.lines : ungated).push(line);
  }
  if (open) throw new Error(`the aw-min ${open.min} section opened at line ${open.at} is never closed`);
  return { ungated: ungated.join("\n"), gated };
}

/** Whether the installed aw (its `aw version` text) is at least `min`, on
 *  major.minor.patch: a release candidate of `min` carries its commands. */
export function awAtLeast(versionText, min) {
  const m = /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(String(versionText));
  if (!m) return false;
  const a = m.slice(1, 4).map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
