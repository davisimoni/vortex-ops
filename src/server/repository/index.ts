import { logger } from "@/lib/logger";
import { MemoryRepository } from "@/server/repository/memory";
import { PrismaRepository } from "@/server/repository/prisma";
import type { VortexRepository } from "@/server/repository/types";

/**
 * Driver selection.
 *
 * `DATABASE_URL` present → Prisma. Absent, or the client cannot be loaded →
 * the in-process store. The decision is made once per process and logged, so
 * "why is my data gone after a redeploy" is answerable from the boot logs
 * rather than by reading this file.
 *
 * The Prisma import is dynamic and its failure is caught. That is what makes
 * the guarantee in the brief true: `npm run build` and `npm start` cannot fail
 * because a database is unreachable or `prisma generate` has not been run. The
 * cost of that guarantee is that a *misconfigured* production deployment
 * silently serves ephemeral data — so it is loud in the logs, reported by
 * `/api/health`, and shown as a banner in the UI. Degrading quietly would be
 * the actual failure.
 */

export type RepositoryDriver = "prisma" | "memory";

interface RepositoryHandle {
  readonly repository: VortexRepository;
  readonly driver: RepositoryDriver;
  /** Why the memory driver was chosen, when it was not the intent. */
  readonly degradedReason: string | null;
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
 * connection pool within a few saves.
 */
async function loadPrismaClient(): Promise<PrismaClientInstance | null> {
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
  });

  // Connect eagerly: a lazy client would defer the failure to the first real
  // query, by which point we have already told the caller we are persistent.
  await client.$connect();

  globals[PRISMA_GLOBAL] = client;
  return client;
}

async function selectRepository(): Promise<RepositoryHandle> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    logger.info("Storage driver selected", {
      driver: "memory",
      reason: "DATABASE_URL is not set",
    });
    const repository = new MemoryRepository();
    await repository.ensureSeeded();
    return { repository, driver: "memory", degradedReason: null };
  }

  try {
    const client = await loadPrismaClient();
    if (!client) throw new Error("Prisma client unavailable");

    const repository = new PrismaRepository(client);
    await repository.ensureSeeded();

    logger.info("Storage driver selected", { driver: "prisma" });
    return { repository, driver: "prisma", degradedReason: null };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Prisma client could not be initialised";

    // Deliberately not rethrown. DATABASE_URL was set, so this *is* a
    // misconfiguration — but taking the whole application down for it would
    // turn a degraded deploy into an outage. It is recorded as an error, and
    // surfaced everywhere an operator looks.
    logger.exception("Falling back to in-memory storage", error, {
      driver: "memory",
      intended: "prisma",
    });

    const repository = new MemoryRepository();
    await repository.ensureSeeded();
    return { repository, driver: "memory", degradedReason: reason };
  }
}

export function getRepositoryHandle(): Promise<RepositoryHandle> {
  const globals = globalThis as GlobalWithRepository;
  globals[GLOBAL_KEY] ??= selectRepository();
  return globals[GLOBAL_KEY];
}

export async function getRepository(): Promise<VortexRepository> {
  return (await getRepositoryHandle()).repository;
}

/** Driver metadata for `/api/health` and the UI banner. */
export async function getStorageStatus(): Promise<{
  driver: RepositoryDriver;
  durable: boolean;
  degradedReason: string | null;
}> {
  const handle = await getRepositoryHandle();
  return {
    driver: handle.driver,
    durable: handle.driver === "prisma",
    degradedReason: handle.degradedReason,
  };
}

/** Test seam: suites build their own repository and must not inherit this one. */
export function resetRepositoryCache(): void {
  delete (globalThis as GlobalWithRepository)[GLOBAL_KEY];
}
