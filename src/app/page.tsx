import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.role === "SUPER_ADMIN") redirect("/office");
  if (session.role === "ADMIN") redirect("/dashboard");
  redirect("/clients");
}
