# Addon names in project.c3proj follow the editor's language

**Status:** investigated in C3 (r495-2, 2026-09-26): the name is display text C3 writes on
every save and never reads. Fix: never conflict on it (NOTES.md). Script:
`fixtures/real/common/addon-names.ts` (results in `addon-names.json` next to it).

## What C3 does (r495-2, lab project and con-sule, fresh profiles)
- Every save rewrites every `usedAddons[].name`, in the editor's language: a plain save with
  no edit in a French editor turns "Text" into "Texte", "Tilemap" into "Tuilage", "Tiled
  Background" into "Arrière-plan Répété". Saving again in an English editor writes the English
  names back. The editor's language is its UI language setting (from the browser's language in
  a fresh profile).
- C3 doesn't read the name: a project whose names were all replaced with nonsense ("nonsense
  Sprite") opens normally, and the next save writes the real names.
- Brackets mean "no translation in this language": C3 shows the English name in brackets and
  saves that. Third-party addons ship English only, so in a French editor they always come out
  bracketed ("[Better Outline]", "[Reflecting Water]"); so do some built-in ones whose French
  translation is missing in r495-2 (File system, Steamworks, Bound to, Destroy outside, Alpha
  clamp). English names also change between releases ("Destroy outside" → "Destroy outside
  layout").

## What the history shows
`usedAddons[]` entries carry a `name` (fields: `type`, `id`, `name`, `author`, `bundled`,
`version`, `sdkVersion`). In con-sule (SuperOctoColor, 7 devs) that name is the addon's
display name **in the language of the editor that saved the project**:
- One dev saves with C3 in French: 74 of their 92 commits touching `project.c3proj` have
  French names ("Array" → "Tableau", "Mouse" → "Souris", "Keyboard" → "Clavier", "Tiled
  Background" → "Arrière-plan Répété", "Drawing canvas" → "Canevas de dessin"…). Other devs
  pick those up through merges and save them back in English.
- 128 of the 863 non-merge commits that touch `project.c3proj` flip the language of the
  names. A single French save rewrote 48 names at once (con-sule `f7fb1815e`, theirs side).
- Some names come out in brackets: `[File system]`, `[Steamworks]`, `[Destroy outside]`,
  `[Bound to]`, `[Alpha clamp]`, and Federico Calchera's effects (`[Reflecting Water]`,
  `[Dissolve]`, `[Palette Swap 8]`…). Built-in and third-party alike.

## What it costs in merges
- c3merge: `usedAddons` is a set keyed by `type+id`, so a name flip is an ordinary change.
  On con-sule it gives 4 conflicted files with nothing else in them (the same addon added on
  both sides, "Drawing canvas" vs "Canevas de dessin"; an addon removed on one side while
  the other only flipped its name) and 3 more on a whole `usedAddons` list (below).
- git: two merges (`f7fb1815e`, `0bec2d0ea`) merged "cleanly" into a project listing
  `DrawingCanvas` **twice**, once per language, and were committed that way. The first
  duplicate on main is `4a825e44` (2026-02-16); main today has none. Later merges where one
  side had the duplicate are the 3 whole-list conflicts: c3merge's keyed list falls back to
  a whole-list conflict when a key repeats.

## Questions (answered above except 5)
1. Does every save rewrite every name, or only when the addon list changes? (Open an
   English project in a French editor, change nothing or one layout, save, diff.)
2. Is it the editor's UI language setting, or something else (OS locale, addon lang files)?
3. What do the brackets mean? Missing translation for that language? Addon not loaded?
4. Does C3 read `name` on load at all (the missing-addon dialog, anything else)? A lab row:
   a wrong / English / missing name in `usedAddons` → load, preview, save.
5. Is anything else in the project files written in the editor's language (default
   behavior names are, but those become user names; anything C3 rewrites on every save?).

## Fix path
- Profile: never conflict on `usedAddons[].name`; take ours (skymen, 2026-09-27). An entry
  deleted on one side and only renamed on the other is deleted.
- Tolerate a repeated `type+id` in `usedAddons` (merge the duplicates into one) instead of
  a whole-list conflict, since git-merged projects already contain them.
- `check`: an addon listed twice is at most an info (C3 de-duplicates it, lab row 36b).
