/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");

// Load .env and .env.local
for (const file of [".env", ".env.local"]) {
  const envPath = path.join(__dirname, file);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const { PrismaClient, Role } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const passwordHash = await bcrypt.hash("Admin@12345", 12);

    // Create businesses
    const businesses = {};
    for (const b of [
      { name: "NEXUP", slug: "nexup", currencyMode: "SAR_TO_EGP" },
      { name: "REBOUND", slug: "rebound", currencyMode: "EGP_DIRECT" },
      { name: "ABOMAZEN", slug: "abomazen", currencyMode: "EGP_DIRECT" },
    ]) {
      businesses[b.slug] = await prisma.business.upsert({
        where: { slug: b.slug }, update: {}, create: b,
      });
    }
    console.log("✅ Businesses created");

    // Create partners
    const partners = {};
    for (const name of ["SAIED", "ADEL", "MOATASEM", "MOUSSA"]) {
      partners[name] = await prisma.partner.upsert({
        where: { name }, update: {}, create: { name },
      });
    }
    console.log("✅ Partners created");

    // ═══════════════════════════════════════════════════════
    // Users: Only ONE SUPER_ADMIN (superadmin@nexup)
    // Others are ADMIN with specific permissions
    // ═══════════════════════════════════════════════════════
    const users = [
      // SUPER_ADMIN — Full access to everything
      { name: "Super Admin", email: "superadmin@nexup", role: Role.SUPER_ADMIN, canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true },
      // ADMIN users — Each has specific permissions
      { name: "SAIED", email: "saied@nexup.local", role: Role.ADMIN, canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true },
      { name: "ADEL", email: "adel@nexup.local", role: Role.ADMIN, canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true },
      { name: "MOATASEM", email: "moatasem@nexup.local", role: Role.ADMIN, canAccessNexup: false, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true },
      { name: "MOUSSA", email: "moussa@nexup.local", role: Role.ADMIN, canAccessNexup: false, canAccessRebound: true, canAccessAbomazen: true, canAccessOfficeFinanceFull: true },
    ];

    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, passwordHash, role: u.role, canAccessNexup: u.canAccessNexup, canAccessRebound: u.canAccessRebound, canAccessAbomazen: u.canAccessAbomazen, canAccessOfficeFinanceFull: u.canAccessOfficeFinanceFull },
        create: { ...u, passwordHash, businessId: null },
      });
    }
    console.log("✅ Users created");

    console.log("\n🎉 Seed completed!");
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 Default Login (SUPER_ADMIN):");
    console.log("   Email: superadmin@nexup");
    console.log("   Password: Admin@12345");
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 Other users (ADMIN role):");
    console.log("   saied@nexup.local | adel@nexup.local (Full access)");
    console.log("   moatasem@nexup.local | moussa@nexup.local (REBOUND + ABOMAZEN + Office)");
    console.log("   All passwords: Admin@12345");
    console.log("═══════════════════════════════════════════════════");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
