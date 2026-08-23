/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient, Role } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("Admin@12345", 12);

  await prisma.user.upsert({
    where: { email: "admin@nexup.local" },
    update: { name: "مدير Nexup", passwordHash, role: Role.ADMIN },
    create: {
      name: "مدير Nexup",
      email: "admin@nexup.local",
      passwordHash,
      role: Role.ADMIN,
    },
  });
}

main()
  .then(() => console.log("تم إنشاء مستخدم المدير التجريبي بنجاح."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
