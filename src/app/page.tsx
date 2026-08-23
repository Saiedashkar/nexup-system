import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  redirect(session.role === "ADMIN" ? "/dashboard" : "/clients");
}
