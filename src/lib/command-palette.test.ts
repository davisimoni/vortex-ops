import { describe, expect, it } from "vitest";

import { filterCommands, matchesQuery, type SearchableCommand } from "@/lib/command-palette";

const COMMANDS: readonly SearchableCommand[] = [
  { id: "dashboard", label: "Dashboard", keywords: ["metrics", "home"] },
  { id: "topology", label: "Topology", keywords: ["services", "dependency graph"] },
  { id: "audit", label: "Audit & compliance", keywords: ["soc2", "export", "csv"] },
];

describe("matchesQuery", () => {
  it("matches everything for an empty or whitespace-only query", () => {
    expect(matchesQuery(COMMANDS[0] as SearchableCommand, "")).toBe(true);
    expect(matchesQuery(COMMANDS[0] as SearchableCommand, "   ")).toBe(true);
  });

  it("matches on the label, case-insensitively", () => {
    expect(matchesQuery(COMMANDS[0] as SearchableCommand, "dash")).toBe(true);
    expect(matchesQuery(COMMANDS[0] as SearchableCommand, "DASH")).toBe(true);
  });

  it("matches on a keyword the label itself does not contain", () => {
    expect(matchesQuery(COMMANDS[2] as SearchableCommand, "soc2")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesQuery(COMMANDS[0] as SearchableCommand, "xyz-nonexistent")).toBe(false);
  });
});

describe("filterCommands", () => {
  it("returns everything, in the original order, for an empty query", () => {
    expect(filterCommands(COMMANDS, "").map((c) => c.id)).toEqual(["dashboard", "topology", "audit"]);
  });

  it("narrows to only the matching commands", () => {
    expect(filterCommands(COMMANDS, "graph").map((c) => c.id)).toEqual(["topology"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommands(COMMANDS, "nonexistent-thing")).toEqual([]);
  });
});
