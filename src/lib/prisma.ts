import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SOFT_DELETE_MODEL_SET } from "./soft-delete-models";

/* ═══════════════════════════════════════════════════════
   Raw (unfiltered) client — sees every row, deleted or not.
   Only for: soft-delete helpers, recycle bin, restore/purge.
   ═══════════════════════════════════════════════════════ */

function createRawClient() {
  const url = process.env.DATABASE_URL || "";
  // TLS is required against Supabase (self-signed chain accepted via the
  // adapter's relaxed check). DATABASE_SSL_DISABLE=1 opts out explicitly —
  // used by the isolated-DB test harness and local dev servers without TLS.
  const ssl = process.env.DATABASE_SSL_DISABLE === "1" ? false : { rejectUnauthorized: false };
  const pool = new (require("pg").Pool)({ connectionString: url, ssl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

type RawClient = ReturnType<typeof createRawClient>;

const READ_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Soft-delete aware client.
 *
 * Any read on a soft-deletable model automatically gets `deletedAt: null`
 * merged into its `where`, so deleted records disappear from every list,
 * total, balance and count without touching the surrounding business logic.
 * Writes are passed through untouched.
 */
function createClient(raw: RawClient) {
  return raw.$extends({
    name: "softDelete",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !SOFT_DELETE_MODEL_SET.has(model) || !READ_OPERATIONS.has(operation)) {
            return query(args);
          }

          const nextArgs = { ...((args as Record<string, unknown> | undefined) ?? {}) };
          const where = (nextArgs.where as Record<string, unknown> | undefined) ?? undefined;

          // findUnique* requires at least one unique field in `where`,
          // so only touch it when the caller actually supplied one.
          const needsUniqueWhere = operation === "findUnique" || operation === "findUniqueOrThrow";
          if (needsUniqueWhere && (!where || Object.keys(where).length === 0)) {
            return query(nextArgs);
          }

          nextArgs.where = { ...(where ?? {}), deletedAt: null };
          return query(nextArgs);
        },
      },
    },
  });
}

const prismaGlobal = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
  prismaRaw?: RawClient;
};

export const prismaRaw: RawClient = prismaGlobal.prismaRaw ?? createRawClient();
export const prisma = prismaGlobal.prisma ?? createClient(prismaRaw);

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.prismaRaw = prismaRaw;
  prismaGlobal.prisma = prisma;
}
