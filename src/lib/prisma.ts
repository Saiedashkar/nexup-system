import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prismaGlobal = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "";
  const adapter = new PrismaPg({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return new PrismaClient({ adapter });
}

export const prisma = prismaGlobal.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") prismaGlobal.prisma = prisma;
