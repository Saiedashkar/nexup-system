import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { slug } = await params;

  // Verify business exists
  const business = await prisma.business.findUnique({ where: { slug } });
  if (!business) redirect("/office");

  // For SUPER_ADMIN: redirect to dashboard with business context
  // For ADMIN/EMPLOYEE: verify they have access to this business
  if (session.role === "SUPER_ADMIN") {
    // Set business context via cookie and redirect to dashboard
    redirect(`/dashboard?business=${slug}`);
  }

  if (session.businessId !== business.id) {
    redirect("/office");
  }

  redirect(`/dashboard`);
}
