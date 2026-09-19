/* One-off cleanup: detach legacy paired OfficeExpense rows from capital
 * contributions. Deletes nothing permanently — only soft-deletes (recoverable
 * from the recycle bin). Run once: node scripts/cleanup-paired-expenses.mjs */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const contribs = await db.capitalContribution.findMany({
    where: { linkedExpenseId: { not: null } },
    select: { id: true, amount: true, linkedExpenseId: true },
  });
  console.log(`Found ${contribs.length} capital contribution(s) with a linked expense.`);

  for (const c of contribs) {
    if (!c.linkedExpenseId) continue;
    const expense = await db.officeExpense.findUnique({ where: { id: c.linkedExpenseId } });
    if (!expense) {
      // Stale pointer — just clear it.
      await db.capitalContribution.update({ where: { id: c.id }, data: { linkedExpenseId: null } });
      console.log(`- ${c.id}: stale pointer cleared.`);
      continue;
    }
    if (!expense.deletedAt) {
      await db.officeExpense.update({
        where: { id: expense.id },
        data: { deletedAt: new Date(), deletedByUserId: null },
      });
      console.log(`- ${c.id}: soft-deleted paired expense "${expense.description}" (${expense.cost} EGP).`);
    } else {
      console.log(`- ${c.id}: paired expense already deleted.`);
    }
    await db.capitalContribution.update({ where: { id: c.id }, data: { linkedExpenseId: null } });
  }

  // Safety net: hide any other office-expense rows that were auto-created for
  // capital contributions but whose contribution pointer was already cleared.
  const orphans = await db.officeExpense.findMany({
    where: { deletedAt: null, notes: { contains: "مساهمة رأس مال رقم" } },
  });
  for (const o of orphans) {
    await db.officeExpense.update({
      where: { id: o.id },
      data: { deletedAt: new Date(), deletedByUserId: null },
    });
    console.log(`- orphan paired expense "${o.description}" (${o.cost} EGP) soft-deleted.`);
  }

  console.log("Cleanup done.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
