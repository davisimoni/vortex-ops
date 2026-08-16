import { existsSync } from "node:fs";
import { join } from "node:path";

import { logger } from "@/lib/logger";
import { isVercelRuntime } from "@/lib/runtime-env";
import { MemoryRepository } from "@/server/repository/memory";
import { PrismaRepository } from "@/server/repository/prisma";
import type { VortexRepository } from "@/server/repository/types";

/**
 * Driver selection.
 *
 * `DATABASE_URL` present → Prisma against it. Absent → a local SQLite file if
 * one has already been prepared (`npm run db:push`) and this process has a
 * real, persistent filesystem to read it from; otherwise the in-process
 * store. Any of those three failing to construct → the in-process store. The
 * decision is made once per process and logged, so "why is my data gone
 * after a redeploy" is answerable from the boot logs rather than by reading
 * this file.
 *
 * The Prisma import is dynamic and its failure is caught. That is what makes
 * the guarantee in the brief true: `npm run build` and `npm start` cannot fail
 * because a database is unreachable or `prisma generate` has not been run. The
 * cost of that guarantee is that a *misconfigured* production deployment
 * silently serves ephemeral data — so it is loud in the logs, reported by
 * `/api/health`, and shown as a badge in the UI. Degrading quietly would be
 * the actual failure.
 */

export type RepositoryDriver = "prisma" | "memory";

interface RepositoryHandle {
  readonly repository: VortexRepository;
  readonly driver: RepositoryDriver;
  /** Why the memory driver was chosen, when it was not the intent. */
  readonly degradedReason: string | null;
  /** True when Prisma is backed by the auto-detected local SQLite file, not an explicit DATABASE_URL. */
  readonly autoDetectedSqlite: boolean;
}

const GLOBAL_KEY = Symbol.for("vortex.repository");

interface GlobalWithRepository {
  [GLOBAL_KEY]?: Promise<RepositoryHandle>;
}

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The Prisma client is loaded dynamically so a missing generated client is a
 * runtime fallback rather than a build failure; it therefore has no static type
 * at this seam. Everything it returns is narrowed inside PrismaRepository. */
type PrismaClientInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const PRISMA_GLOBAL = Symbol.for("vortex.prisma-client");

interface GlobalWithPrisma {
  [PRISMA_GLOBAL]?: PrismaClientInstance;
}

/**
 * Loads a Prisma client, or `null` if one is not usable.
 *
 * Cached on `globalThis` because Next re-evaluates modules on every edit in
 * development, and a fresh `PrismaClient` per reload exhausts the database's
 * connection pool within a few saves. `datasourceUrl` overrides `env("DATABASE_URL")`
 * from the schema — used for the auto-detected local SQLite path below, which
 * by definition has no `DATABASE_URL` set to read.
 */
async function loadPrismaClient(datasourceUrl?: string): Promise<PrismaClientInstance | null> {
  const globals = globalThis as GlobalWithPrisma;
  if (globals[PRISMA_GLOBAL]) return globals[PRISMA_GLOBAL];

  // Typed as `unknown` and narrowed by hand: the whole point of importing the
  // client dynamically is to tolerate its absence, so its generated types
  // cannot be depended on at this seam.
  const loaded: unknown = await import("@prisma/client");
  const Constructor = (loaded as { PrismaClient?: unknown }).PrismaClient;

  if (typeof Constructor !== "function") {
    throw new Error("@prisma/client loaded but exported no PrismaClient — run `prisma generate`.");
  }

  const client = new (Constructor as new (options?: unknown) => PrismaClientInstance)({
    log: ["warn", "error"],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });

  // Connect eagerly: a lazy client would defer the failure to the first real
  // query, by which point we have already told the caller we are persistent.
  await client.$connect();

  globals[PRISMA_GLOBAL] = client;
  return client;
}

/** Absolute, unambiguous — see the README callout on why a relative `file:` path here is a trap. */
const LOCAL_SQLITE_PATH = join(process.cwd(), "prisma", "dev.db");

/**
 * A local SQLite database to fall back to when `DATABASE_URL` is unset, or
 * `null` if none applies.
 *
 * Deliberately does not create or migrate anything — it only looks for a
 * database `npm run db:push` (documented in the README) has already produced
 * at the conventional path. Finding nothing here falls through to the
 * existing in-memory store exactly as before; this only removes the one
 * remaining manual step — setting `DATABASE_URL` — for someone who has
 * already done the real setup, on a platform where a local file can actually
 * stay written between requests.
 *
 * Skipped entirely on Vercel (`isVercelRuntime()`): outside `/tmp`, a
 * deployed function's filesystem is read-only. A committed database file
 * would be readable there but not writable, which is worse than the honest
 * in-memory fallback — reads would appear to work and every write would fail
 * with a confusing database error instead of the product just working,
 * ephemerally, the way the badge already says it does.
 */
function resolveDefaultSqliteUrl(): string | null {
  if (isVercelRuntime()) return null;
  if (!existsSync(LOCAL_SQLITE_PATH)) return null;
  // An absolute path, not `file:./dev.db`: relative SQLite paths resolve
  // against `prisma/schema.prisma`'s own directory, not the process's cwd —
  // confirmed empirically, because it is exactly the kind of thing that is
  // otherwise a silent, hard-to-diagnose "wrong file" bug. An absolute path
  // sidesteps the question entirely.
  return `file:${LOCAL_SQLITE_PATH}`;
}

interface PrismaAttempt {
  readonly repository: PrismaRepository | null;
  /** Set only on failure — the caught error's message, for degradedReason. */
  readonly failureReason: string | null;
}

async function tryPrisma(datasourceUrl: string | undefined, logContext: Record<string, unknown>): Promise<PrismaAttempt> {
  try {
    const client = await loadPrismaClient(datasourceUrl);
    if (!client) throw new Error("Prisma client unavailable");

    const repository = new PrismaRepository(client);
    await repository.ensureSeeded();
    return { repository, failureReason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Prisma client could not be initialised";
    // Deliberately not rethrown. Taking the whole application down for a
    // storage misconfiguration would turn a degraded deploy into an outage.
    // It is recorded as an error, and surfaced everywhere an operator looks.
    logger.exception("Falling back to in-memory storage", error, {
      driver: "memory",
      intended: "prisma",
      ...logContext,
    });
    return { repository: null, failureReason: reason };
  }
}

async function selectRepository(): Promise<RepositoryHandle> {
  // Escape hatch for the E2E suite, not something a real deployment should set:
  // it exists so `npm run db:push` having produced a real prisma/dev.db in this
  // working directory (a normal thing for a developer to have done) cannot make
  // `npm run start` pick it up mid test run and break the suite's "every run
  // starts from the same seeded fixtures, isolated per process" guarantee.
  if (process.env.VORTEX_FORCE_MEMORY_STORAGE === "1") {
    logger.info("Storage driver selected", { driver: "memory", reason: "VORTEX_FORCE_MEMORY_STORAGE is set" });
    const repository = new MemoryRepository();
    await repository.ensureSeeded();
    return { repository, driver: "memory", degradedReason: null, autoDetectedSqlite: false };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const attempt = await tryPrisma(undefined, { source: "DATABASE_URL" });
    if (attempt.repository) {
      logger.info("Storage driver selected", { driver: "prisma", source: "DATABASE_URL" });
      return { repository: attempt.repository, driver: "prisma", degradedReason: null, autoDetectedSqlite: false };
    }

    const repository = new MemoryRepository();
    await repository.ensureSeeded();
    // DATABASE_URL was set, so this is a real misconfiguration — degradedReason
    // is what drives the crit-toned banner/health check, not the plain one.
    return { repository, driver: "memory", degradedReason: attempt.failureReason, autoDetectedSqlite: false };
  }

  const localSqliteUrl = resolveDefaultSqliteUrl();
  if (localSqliteUrl) {
    const attempt = await tryPrisma(localSqliteUrl, { source: "auto-detected local SQLite file" });
    if (attempt.repository) {
      logger.info("Storage driver selected", { driver: "prisma", source: "auto-detected local SQLite file" });
      return { repository: attempt.repository, driver: "prisma", degradedReason: null, autoDetectedSqlite: true };
    }
    // Found prisma/dev.db but could not open it (wrong schema provider,
    // corrupted file, stale generated client) — fall through to memory below
    // exactly as if the file had never been there. tryPrisma() already logged why.
  }

  logger.info("Storage driver selected", {
    driver: "memory",
    reason: "DATABASE_URL is not set" + (localSqliteUrl ? " and the local SQLite file could not be opened" : ""),
  });
  const repository = new MemoryRepository();
  await repository.ensureSeeded();
  return { repository, driver: "memory", degradedReason: null, autoDetectedSqlite: false };
}

export function getRepositoryHandle(): Promise<RepositoryHandle> {
  const globals = globalThis as GlobalWithRepository;
  globals[GLOBAL_KEY] ??= selectRepository();
  return globals[GLOBAL_KEY];
}

export async function getRepository(): Promise<VortexRepository> {
  return (await getRepositoryHandle()).repository;
}

/** Driver metadata for `/api/health` and the UI badge. */
export async function getStorageStatus(): Promise<{
  driver: RepositoryDriver;
  durable: boolean;
  degradedReason: string | null;
  autoDetectedSqlite: boolean;
}> {
  const handle = await getRepositoryHandle();
  return {
    driver: handle.driver,
    durable: handle.driver === "prisma",
    degradedReason: handle.degradedReason,
    autoDetectedSqlite: handle.autoDetectedSqlite,
  };
}

/** Test seam: suites build their own repository and must not inherit this one. */
export function resetRepositoryCache(): void {
  delete (globalThis as GlobalWithRepository)[GLOBAL_KEY];
}
