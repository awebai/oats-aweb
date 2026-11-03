// What oats.aweb must never put into a home: any mention of the task-
// coordination layer. Task coordination is taught only by oats.aweb-tasks,
// when a deployment composes it. These patterns spare the allowed uses: the
// agent's own task ("your task", TASK.md, "task boundaries"), OATS attention
// claims ("unread-delivery attention claims", "waiting claim"), `aw
// workspace`, and "coordination" as aweb's name for its server.
//
// The text is scanned whole, not line by line, so a phrase Markdown wraps
// onto the next line is still caught; between the words of a phrase, `gap`
// also crosses inline-code and emphasis marks (`work` or `claim`).
const gap = "[\\s`*_]+";
const phrase = (source) => new RegExp(source.replaceAll("GAP", gap), "gi");
export const TASK_COORDINATION = [
  ["an aw task, work, lock or roles command", /\baw\s+(?:--?[\w-]+(?:[ =][^\s-]\S*)?\s+)*(?:task|work|lock|roles)\b/gi],
  ["the oats.aweb-tasks capability or its skill", /\baweb-tasks\b/gi],
  ["the aweb-coordination skill", /\baweb-coordination\b/gi],
  ["the task layer", phrase("\\btasks?(?:GAP|-)layer\\b")],
  ["task coordination", phrase("\\b(?:task|work)GAPcoordination\\b")],
  ["task tracking, state or records", phrase("\\btasks?GAP(?:tracking|state|records?)\\b")],
  ["a coordination loop", phrase("\\bcoordinationGAP(?:pollingGAP)?loops?\\b")],
  ["a task claim", phrase("\\bclaim(?:s|ed)?GAP(?:(?:a|an|the|this|that|your|their)GAP)?(?:tasks?|work|issues?)\\b")],
  ["claiming", /\bclaiming\b/gi],
  ["work and claim events", phrase("\\bwork[`*_]*\\s*(?:/|,|\\bor\\b|\\band\\b)(?:GAP(?:or|and))?(?:GAP|[`*_]*)claim\\b")],
];

/** Every mention in `text`, as `{line, what, match}`; `line` (from 1) is where the match starts. */
export function taskCoordinationMentions(text) {
  const source = String(text), found = [];
  const lineAt = (index) => source.slice(0, index).split("\n").length;
  for (const [what, pattern] of TASK_COORDINATION) {
    for (const match of source.matchAll(pattern)) found.push({ line: lineAt(match.index), what, match: match[0] });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** One failure line per mention: `<source>:<line>: <what>: "<matched text>"`. */
export function describeTaskCoordination(source, text) {
  return taskCoordinationMentions(text).map((m) => `${source}:${m.line}: ${m.what}: ${JSON.stringify(m.match)}`);
}
