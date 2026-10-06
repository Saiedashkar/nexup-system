import { describe, expect, it } from "vitest";

import { DEPARTMENT_IDS, type DepartmentId } from "@/components/command/state/organization-model";
import {
  departmentAttention,
  departmentMissions,
  totalAttention,
  totalMissions,
} from "@/components/command/state/department-workspace";
import { MOCK_PROJECTS } from "@/components/command/state/demo-scenarios";

/**
 * The Command Center's counts now come from one place: `departmentMissions()`,
 * `departmentAttention()`, `totalMissions()` and `totalAttention()`. The graph
 * nodes, the List rows, the pods, the mobile hint and the top KPI all read them,
 * so nothing here asserts a number a component renders — it asserts the model
 * those components read, which is what stops the counts drifting apart again.
 *
 * The expectation below is the contract. If a row fails, the shared model is
 * wrong, not the row.
 */
type Expectation = {
  id: DepartmentId;
  label: string;
  missions: number;
  attention: number;
};

const EXPECTED: Expectation[] = [
  { id: "operations", label: "Operations", missions: 2, attention: 2 },
  { id: "client", label: "Client & Delivery", missions: 2, attention: 1 },
  { id: "product", label: "Product & Tech", missions: 3, attention: 1 },
  { id: "growth", label: "Growth & Revenue", missions: 4, attention: 2 },
  { id: "finance", label: "Finance & Control", missions: 2, attention: 2 },
];

const TOTAL_MISSIONS = 13;
const TOTAL_ATTENTION = 8;

describe("Command Center shared state", () => {
  it("covers every department exactly once", () => {
    expect([...EXPECTED.map((row) => row.id)].sort()).toEqual([...DEPARTMENT_IDS].sort());
  });

  it.each(EXPECTED)("$label: $missions missions, $attention needing attention", ({ id, missions, attention }) => {
    expect(departmentMissions(id)).toHaveLength(missions);
    expect(departmentAttention(id)).toBe(attention);
  });

  it("reports organization totals through the shared selectors", () => {
    expect(totalMissions()).toBe(TOTAL_MISSIONS);
    expect(totalAttention()).toBe(TOTAL_ATTENTION);
  });

  it("derives every panel row from the same department missions", () => {
    const missionIds = DEPARTMENT_IDS.flatMap((id) => departmentMissions(id).map((mission) => mission.id));
    expect(MOCK_PROJECTS.map((project) => project.id)).toEqual(missionIds);
  });
});
