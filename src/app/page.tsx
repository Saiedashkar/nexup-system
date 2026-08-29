import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  // All authenticated users go to /office — the page itself filters by permissions
  redirect("/office");
}
