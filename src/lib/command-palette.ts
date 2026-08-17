/**
 * Pure matching logic for the command palette (`⌘K`/`Ctrl+K`).
 *
 * Plain case-insensitive substring matching over a label plus optional
 * keywords — the same level of "search sophistication" the live log viewer
 * already uses (`lib/log-format.ts`), not a fuzzy-matching library. A command
 * palette with six pages and a handful of actions does not need one, and a
 * library here would be bundle size spent on a problem three lines already
 * solve.
 */

export interface SearchableCommand {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
}

export function matchesQuery(command: SearchableCommand, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  const haystack = [command.label, ...(command.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(needle);
}

/** Filters a list of commands, preserving their given order — no relevance ranking to keep stable. */
export function filterCommands<T extends SearchableCommand>(
  commands: readonly T[],
  query: string,
): T[] {
  return commands.filter((command) => matchesQuery(command, query));
}
