// Profile lookup: which rule applies to a value, from the file's repo path and the value's
// path inside the file. The rules themselves are data (profiles.json).
import data from "./profiles.json" with { type: "json" };

export type Rule =
  | { id: string[]; also?: string[]; moves?: boolean; order: "ordered" | "set" }
  | { atomic: true }
  | { scalar: "max" }
  | { lines: true };

export interface Profile { kind: string; rules: Record<string, Rule> }

const KINDS = data.kinds.map((k) => ({ kind: k.kind, match: new RegExp(k.match), rules: k.rules as Record<string, Rule> }));

// Files that aren't a known C3 kind (e.g. JSON under files/) get the default rules only.
export function profileFor(repoPath: string): Profile {
  const p = repoPath.split("\\").join("/");
  return KINDS.find((k) => k.match.test(p)) ?? { kind: "json", rules: {} };
}

// Keys that are user-chosen names (effects, variables, behaviors, parameters, properties)
// collapse to `*`; recursive nesting (children[].children[], subLayers, subfolders) to one level.
const DYNAMIC = /\.(effects|instanceVariables|behaviors|parameters|properties)\.[^.[\]]+/g;
export const normalize = (pattern: string) =>
  pattern.replace(DYNAMIC, ".$1.*").replace(/((\.[^.[\]]+\[\])+?)\1+/g, "$1");

export function ruleFor(profile: Profile, pattern: string): Rule | undefined {
  const p = normalize(pattern);
  if (profile.rules[p]) return profile.rules[p];
  for (const [key, rule] of Object.entries(profile.rules)) {
    if (key.startsWith("**.") && (p === key.slice(3) || p.endsWith(key.slice(2)))) return rule;
  }
  return undefined;
}
