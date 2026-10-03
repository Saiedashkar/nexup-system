import { notFound } from "next/navigation";
import { DepartmentWorkspace } from "@/components/command/workspace/department-workspace";
import { departmentIdForSlug } from "@/components/command/state/department-workspace";

/**
 * DEPARTMENT WORKSPACE — one route, five departments (Phase UI-03)
 * ──────────────────────────────────────────────────────────────
 * ROUTE: `/command/departments/[departmentId]`
 *
 * This is the ONE implementation of a department workspace. It resolves the
 * route slug to a department id through the configuration model and hands that
 * id to a single client component — there is no per-department page, so
 * `/command/departments/growth-revenue` and
 * `/command/departments/finance-control` are the same page reading different
 * configuration.
 *
 * It sits under the existing `/command` layout, so the shell, the command bar
 * and the Executive console stay mounted: EXEC remains reachable from inside
 * any department without this route re-implementing the shell.
 *
 * There is no data fetching and no database access. `notFound()` is the only
 * exit for an unknown slug, so a bad URL cannot render an empty workspace.
 */
export default async function DepartmentWorkspacePage({
  params,
}: {
  params: Promise<{ departmentId: string }>;
}) {
  const { departmentId } = await params;
  const id = departmentIdForSlug(departmentId);
  if (!id) notFound();

  return <DepartmentWorkspace departmentId={id} />;
}
