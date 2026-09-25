import { execSync } from "node:child_process";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// DATABASE_URL / DATABASE_SSL_DISABLE are injected by tests/mcp-env.setup.ts
// (a vitest setupFile, so they are set before any app module — and its
// Prisma pool — is imported). This module only opens its own admin/test pools.

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 8 });
const admin = new PrismaClient({ adapter: new PrismaPg(pool) });

export const TEST = {
  businessId: "",
  clientId: "",
  projectId: "",
};

function bootstrapUrl(): string {
  // Admin connection = same server, "postgres" maintenance database.
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/postgres";
  return url.toString();
}

export async function setupDatabase(): Promise<void> {
  const dbName = process.env.DATABASE_URL?.split("/").pop() ?? "";
  if (!dbName) throw new Error("TEST_DATABASE_URL must name a database");

  // Create the throwaway database explicitly (idempotent), then push the
  // schema into it. All connections target TEST_DATABASE_URL only —
  // the shared/production Supabase host is never contacted.
  const bootstrap = new Pool({ connectionString: bootstrapUrl(), ssl: false, max: 2 });
  try {
    await bootstrap.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err; // 42P04 = already exists
  } finally {
    await bootstrap.end();
  }
  try {
    execSync("npx prisma db push --accept-data-loss", {
      env: { ...process.env },
      stdio: "pipe",
      cwd: process.cwd(),
    });
  } catch (err) {
    throw new Error(`prisma db push against the local test database failed: ${String(err)}`);
  }

  // Guarantee a clean slate even if a previous run left rows behind.
  await admin.$executeRawUnsafe(`DELETE FROM "McpAuditLog"`);
  await admin.$executeRawUnsafe(`DELETE FROM "McpPendingAction"`);
  await admin.$executeRawUnsafe(`DELETE FROM "ProjectRecord"`);
  await admin.$executeRawUnsafe(`DELETE FROM "Client"`);
  await admin.$executeRawUnsafe(`DELETE FROM "Business"`);

  const business = await admin.business.create({
    data: { name: "NEXUP", slug: "nexup", currencyMode: "SAR_TO_EGP" },
  });
  const client = await admin.client.create({
    data: { businessId: business.id, name: "Pending Test Client", phone: "+966500000001" },
  });
  const project = await admin.projectRecord.create({
    data: {
      businessId: business.id,
      clientId: client.id,
      projectName: "Pending Test Project",
      date: new Date("2026-09-25T00:00:00.000Z"),
      totalPrice: "100",
      deposit: "0",
      remaining: "100",
      paymentStatus: "UNPAID",
      workStatus: "WAITING",
    },
  });

  TEST.businessId = business.id;
  TEST.clientId = client.id;
  TEST.projectId = project.id;
}

export async function teardownDatabase(): Promise<void> {
  const dbName = process.env.DATABASE_URL?.split("/").pop() ?? "";
  await admin.$disconnect();
  await pool.end();
  if (dbName) {
    const bootstrap = new Pool({ connectionString: bootstrapUrl(), ssl: false, max: 2 });
    try {
      // WITH (FORCE): also terminate any backend still connected (e.g. the
      // app's own Prisma pool imported by the code under test).
      await bootstrap.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await bootstrap.end();
    }
  }
}

import type { McpPrincipal } from "../src/lib/mcp/auth";
import type { BusinessSlug } from "../src/lib/mcp/auth";

export function makePrincipal(
  id: string,
  displayName: string,
  businesses: readonly BusinessSlug[],
): McpPrincipal {
  return {
    id,
    displayName,
    role: "MCP_OPERATOR",
    allowedBusinesses: new Set<BusinessSlug>(businesses),
    allowedTools: new Set<string>(["prepare_x", "confirm_x"]),
  };
}

export function operatorPrincipal(): McpPrincipal {
  return makePrincipal("test-principal-A", "Test Principal A", ["nexup", "rebound", "abomazen"]);
}

export function otherPrincipal(): McpPrincipal {
  return makePrincipal("test-principal-B", "Test Principal B", ["nexup", "rebound", "abomazen"]);
}

export function restrictedPrincipal(): McpPrincipal {
  // Same id as operator (same actor), but nexup is NOT in scope.
  return makePrincipal("test-principal-A", "Test Principal A (restricted)", ["rebound", "abomazen"]);
}

export function withRedEnabled<T>(fn: () => T): T {
  const prev = process.env.MCP_RED_ACTIONS_ENABLED;
  process.env.MCP_RED_ACTIONS_ENABLED = "true";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MCP_RED_ACTIONS_ENABLED;
    else process.env.MCP_RED_ACTIONS_ENABLED = prev;
  }
}

export { admin };
