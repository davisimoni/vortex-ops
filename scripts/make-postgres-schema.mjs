import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Derives the Postgres/Supabase schema from the committed SQLite one.
 *
 * Generated rather than copied. The two schemas differ only in the datasource
 * block; a hand-maintained duplicate of two hundred lines of models drifts on
 * the first migration somebody forgets to apply twice, and the drift surfaces
 * as a production-only failure. This script makes the duplicate a build
 * artefact, so there is exactly one place to edit a model.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "prisma", "schema.prisma");
const target = join(root, "prisma", "schema.postgresql.prisma");

const DATASOURCE = /datasource\s+db\s*\{[^}]*\}/;

const schema = readFileSync(source, "utf8");

if (!DATASOURCE.test(schema)) {
  console.error("Could not find a `datasource db { ... }` block in prisma/schema.prisma");
  process.exit(1);
}

const banner = [
  "// ---------------------------------------------------------------------------",
  "// GENERATED FILE — do not edit.",
  "// Produced from prisma/schema.prisma by scripts/make-postgres-schema.mjs.",
  "// Edit the models there and re-run `npm run db:schema:postgres`.",
  "// ---------------------------------------------------------------------------",
  "",
].join("\n");

const postgres = schema.replace(
  DATASOURCE,
  ['datasource db {', '  provider = "postgresql"', '  url      = env("DATABASE_URL")', "}"].join(
    "\n",
  ),
);

writeFileSync(target, `${banner}${postgres}`, "utf8");
console.log(`Wrote ${target}`);
