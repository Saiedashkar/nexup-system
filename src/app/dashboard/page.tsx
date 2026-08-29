import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export default async function DashboardPage() {
  redirect("/office");
}
