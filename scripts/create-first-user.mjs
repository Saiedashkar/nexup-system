#!/usr/bin/env node
/**
 * CREATE THE FIRST USER — no default password, no secret in git.
 *
 *   DATABASE_URL=postgresql://... node scripts/create-first-user.mjs \
 *     --email owner@example.com --name "Owner" \
 *     [--business "NEXUP COMMAND"] [--slug command] \
 *     [--role SUPER_ADMIN|ADMIN] [--password-stdin] [--allow-more]
 *
 * What it guarantees:
 *
 *   · the password is generated here, in memory (24 random bytes → base64url),
 *     printed ONCE to stdout, and never written to a file, an argument, a log or
 *     this repository. A caller that insists on supplying one uses
 *     `--password-stdin` (a pipe), never argv — argv is world-readable on Linux.
 *   · it refuses to run against a database that already has a user unless
 *     `--allow-more` is passed, so a second run cannot quietly add an owner.
 *   · it refuses to run when the target is not reachable, and it prints row counts
 *     and the created ids, never the hash.
 *
 * What it does NOT do: invent a business row if the slug is taken by a different
 * name (it stops instead), or change an existing user's password.
 */

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback;
};

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is not set — point it at the trial database.");

const email = String(value("email", "")).trim().toLowerCase();
const name = String(value("name", "")).trim();
const businessName = String(value("business", "NEXUP COMMAND")).trim();
const slug = String(value("slug", "command"))
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "");
const role = String(value("role", "SUPER_ADMIN")).toUpperCase();

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email must be a real address.");
if (!name) fail("--name is required.");
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) fail("--slug must be 2–31 chars of a-z, 0-9 or -.");
if (!["SUPER_ADMIN", "ADMIN"].includes(role)) fail("--role must be SUPER_ADMIN or ADMIN.");

const ssl = process.env.DATABASE_SSL_DISABLE === "1" ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: databaseUrl, ssl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function password() {
  if (flag("password-stdin")) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const typed = await rl.question("password (not echoed by this script): ");
    rl.close();
    if (typed.length < 16) fail("a supplied password must be at least 16 characters.");
    return typed;
  }
  /* 24 bytes → 32 base64url characters. Printed once, below. */
  return randomBytes(24).toString("base64url");
}

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !flag("allow-more")) {
    fail(
      `this database already has ${existingUsers} user(s); refusing to create another owner.\n` +
        "  Re-run with --allow-more only if that is deliberate.",
    );
  }
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) fail(`a user with ${email} already exists (id ${taken.id}); no password was changed.`);

  const plain = await password();
  const passwordHash = await bcrypt.hash(plain, 12);

  const business = await prisma.business.upsert({
    where: { slug },
    update: {},
    create: { name: businessName, slug },
    select: { id: true, name: true, slug: true },
  });
  if (business.name !== businessName) {
    fail(
      `company slug "${slug}" already belongs to "${business.name}", not "${businessName}".\n` +
        "  Nothing was written. Choose another --slug or --business.",
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role,
      businessId: role === "SUPER_ADMIN" ? null : business.id,
      /* A super admin sees every company; the office-finance flag is what the
         finance surfaces ask for. No other flag is granted by default. */
      canAccessNexup: true,
      canAccessRebound: false,
      canAccessAbomazen: false,
      canAccessOfficeFinanceFull: true,
    },
    select: { id: true, email: true, role: true, name: true },
  });

  const counts = {
    users: await prisma.user.count(),
    businesses: await prisma.business.count(),
  };

  console.log("");
  console.log("  created:");
  console.log(`    business : ${business.slug} (${business.id}) — ${business.name}`);
  console.log(`    user     : ${user.email} (${user.id}) — role ${user.role}`);
  console.log(`    counts   : users=${counts.users} businesses=${counts.businesses}`);
  console.log("");
  console.log("  PASSWORD (shown once — store it in your password manager now):");
  console.log(`    ${plain}`);
  console.log("");
  console.log("  This value is not written anywhere. If it is lost, create a new user");
  console.log("  (there is no reset endpoint) or rotate the hash deliberately.");
  console.log("");
}

main()
  .catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  });
