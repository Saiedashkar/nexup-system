/**
 * NEXUP COMMAND — DEMO SCENARIOS (Phase UI-01)
 * ─────────────────────────────────────────────
 * The eight states we need to review visually before any real runtime event
 * stream is connected. Each scenario is a PURE function from a revision number
 * to a `CommandVisualSnapshot` — no React, no timers, no I/O.
 *
 * This is the seam that keeps the promise of §11: when the real AI Workforce
 * runtime starts emitting events, it produces this same snapshot shape and the
 * visual layer needs no changes at all.
 */

import { DEPARTMENTS, DEPARTMENT_IDS, type DepartmentId } from "./organization-model";
import { departmentMissions } from "./department-workspace";
import {
  idleNode,
  type OrganizationVisualState,
  type VisualNodeState,
} from "./visual-state";

export type DemoScenarioId =
  | "idle"
  | "growth-active"
  | "product-active"
  | "executive-thinking"
  | "handoff"
  | "approval"
  | "completed"
  | "error";

export type ActivityEntry = {
  id: string;
  /** Drives the small accent dot; null for human-level entries. */
  departmentId?: DepartmentId | null;
  text: string;
  time: string;
};

export type ProjectEntry = {
  id: string;
  name: string;
  department: DepartmentId;
  progress: number;
  meta: string;
};

export type ApprovalEntry = {
  id: string;
  department: DepartmentId;
  title: string;
  detail: string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export type CommandVisualSnapshot = {
  scenario: DemoScenarioId;
  /** Bumped on every replay so identical states still re-trigger motion. */
  revision: number;
  /** Plain-language note so a reviewer knows what to look for. */
  narrative: string;
  visual: OrganizationVisualState;
  activity: ActivityEntry[];
  approvals: ApprovalEntry[];
};

/* ── Builders ───────────────────────────────────────────────────────────── */

function idleDepartments(): Record<string, VisualNodeState> {
  const map: Record<string, VisualNodeState> = {};
  for (const id of DEPARTMENT_IDS) map[id] = idleNode();
  return map;
}

type Patch = Partial<VisualNodeState>;

function department(
  current: Record<string, VisualNodeState>,
  id: DepartmentId,
  patch: Patch,
): Record<string, VisualNodeState> {
  return { ...current, [id]: { ...idleNode(), ...patch } };
}

function departmentsWith(patches: Array<[DepartmentId, Patch]>): Record<string, VisualNodeState> {
  return patches.reduce((acc, [id, patch]) => department(acc, id, patch), idleDepartments());
}

const deptName = (id: string) => DEPARTMENTS.find((d) => d.id === id)?.name ?? id;

/* ── Static mock: the organization's missions (scenario-independent) ───────
   Projected from the mission list each department workspace already owns, in
   configuration order. Nothing is invented: a row exists exactly because a
   department is running that mission, with that owner and that progress. This is
   what keeps the Active Missions panel, the context rail and the top KPI
   describing the same missions as the workspaces they came from. */

export const MOCK_PROJECTS: ProjectEntry[] = DEPARTMENT_IDS.flatMap((id) =>
  departmentMissions(id).map((mission) => ({
    id: mission.id,
    name: mission.title,
    department: id,
    progress: mission.progress,
    meta: mission.owner,
  })),
);

/* ── Scenario definitions ───────────────────────────────────────────────── */

export type DemoScenario = {
  id: DemoScenarioId;
  /** Button label in the Motion Lab. */
  label: string;
  narrative: string;
  build: (revision: number) => CommandVisualSnapshot;
};

function executive(patch: Patch): VisualNodeState {
  return { ...idleNode(), ...patch };
}

const SCENARIOS: DemoScenario[] = [
  {
    id: "idle",
    label: "All idle",
    narrative: "The calm baseline. Nothing is running, so almost nothing moves — only the ambient light.",
    build: (revision) => ({
      scenario: "idle",
      revision,
      narrative: "The calm baseline. Nothing is running, so almost nothing moves — only the ambient light.",
      visual: {
        executive: executive({ status: "IDLE" }),
        departments: idleDepartments(),
        handoffs: [],
      },
      activity: [
        { id: "a1", text: "All five departments are idle.", time: "now" },
        { id: "a2", text: "No approvals waiting on you.", time: "—" },
      ],
      approvals: [],
    }),
  },
  {
    id: "growth-active",
    label: "Growth active",
    narrative: "Growth is working, so Executive → Growth carries signal and Growth's worker dots light up.",
    build: (revision) => ({
      scenario: "growth-active",
      revision,
      narrative: "Growth is working, so Executive → Growth carries signal and Growth's worker dots light up.",
      visual: {
        executive: executive({ status: "ACTIVE", activityLevel: 0.34, activeJob: "Monitoring Growth & Revenue" }),
        departments: departmentsWith([
          [
            "growth",
            {
              status: "ACTIVE",
              activityLevel: 0.82,
              activeJob: "Qualifying 42 inbound leads",
              workerActivity: { "growth.market": 0.52, "growth.leads": 0.92, "growth.sales": 0.36 },
            },
          ],
        ]),
        handoffs: [],
      },
      activity: [
        { id: "a1", departmentId: "growth", text: "Lead Acquisition qualified 17 of 42 inbound leads.", time: "2m" },
        { id: "a2", departmentId: "growth", text: "Market Intelligence refreshed competitor signals.", time: "9m" },
        { id: "a3", text: "Executive is supervising one active department.", time: "now" },
      ],
      approvals: [],
    }),
  },
  {
    id: "product-active",
    label: "Product active",
    narrative: "The same contract, a different department — no Growth-specific logic anywhere in the visual layer.",
    build: (revision) => ({
      scenario: "product-active",
      revision,
      narrative: "The same contract, a different department — no Growth-specific logic anywhere in the visual layer.",
      visual: {
        executive: executive({ status: "ACTIVE", activityLevel: 0.28, activeJob: "Reviewing Product & Tech output" }),
        departments: departmentsWith([
          [
            "product",
            {
              status: "ACTIVE",
              activityLevel: 0.78,
              activeJob: "Shipping invoice follow-up automation",
              workerActivity: {
                "product.discovery": 0.22,
                "product.agents": 0.44,
                "product.automation": 0.9,
                "product.fullstack": 0.61,
              },
            },
          ],
        ]),
        handoffs: [],
      },
      activity: [
        { id: "a1", departmentId: "product", text: "Automation deployed follow-up workflow to staging.", time: "1m" },
        { id: "a2", departmentId: "product", text: "Full-stack opened a work item for review.", time: "6m" },
      ],
      approvals: [],
    }),
  },
  {
    id: "executive-thinking",
    label: "Executive thinking",
    narrative: "The router is thinking, so the departments queue behind it and go visibly WAITING instead of idle.",
    build: (revision) => ({
      scenario: "executive-thinking",
      revision,
      narrative: "The router is thinking, so the departments queue behind it and go visibly WAITING instead of idle.",
      visual: {
        executive: executive({
          status: "THINKING",
          activityLevel: 0.58,
          activeJob: "Planning next week across 5 departments",
        }),
        departments: departmentsWith(
          DEPARTMENT_IDS.map((id): [DepartmentId, Patch] => [
            id,
            {
              status: "WAITING",
              activityLevel: 0.12,
              activeJob: "Queued behind the Executive plan",
            },
          ]),
        ),
        handoffs: [],
      },
      activity: [
        { id: "a1", text: "Executive opened a planning pass over all departments.", time: "now" },
        { id: "a2", text: "Five departments are holding for direction.", time: "now" },
      ],
      approvals: [],
    }),
  },
  {
    id: "handoff",
    label: "Growth → Operations",
    narrative: "Watch the connection: energy travels from Growth to Operations, Operations takes the work, Growth decays.",
    build: (revision) => ({
      scenario: "handoff",
      revision,
      narrative: "Watch the connection: energy travels from Growth to Operations, Operations takes the work, Growth decays.",
      visual: {
        executive: executive({ status: "ACTIVE", activityLevel: 0.3, activeJob: "Brokering Growth → Operations handoff" }),
        departments: departmentsWith([
          [
            "growth",
            {
              status: "HANDOFF",
              activityLevel: 0.34,
              activeJob: "Booked 3 enterprise demos",
              handoffTarget: "operations",
            },
          ],
          [
            "operations",
            {
              status: "ACTIVE",
              activityLevel: 0.72,
              activeJob: "Receiving 3 enterprise demos",
              workerActivity: { "operations.process": 0.7, "operations.vendors": 0.34, "operations.quality": 0.45 },
            },
          ],
        ]),
        handoffs: [{ id: `handoff-${revision}`, from: "growth", to: "operations" }],
      },
      activity: [
        { id: "a1", departmentId: "growth", text: "Growth handed 3 enterprise demos to Operations.", time: "now" },
        { id: "a2", departmentId: "operations", text: "Operations accepted the handoff and opened capacity check.", time: "now" },
        { id: "a3", text: "Growth activity is decaying back to idle.", time: "now" },
      ],
      approvals: [],
    }),
  },
  {
    id: "approval",
    label: "Finance approval",
    narrative: "A node held at the approval gate. This is the one state allowed to be visually loud.",
    build: (revision) => ({
      scenario: "approval",
      revision,
      narrative: "A node held at the approval gate. This is the one state allowed to be visually loud.",
      visual: {
        executive: executive({ status: "WAITING", activityLevel: 0.2, activeJob: "Held for human authority" }),
        departments: departmentsWith([
          [
            "finance",
            {
              status: "APPROVAL_REQUIRED",
              activityLevel: 0.3,
              activeJob: "Payment to vendor · 14,200 SAR",
              needsApproval: true,
            },
          ],
        ]),
        handoffs: [],
      },
      activity: [
        { id: "a1", departmentId: "finance", text: "Bookkeeping withheld a vendor payment above the auto-approve limit.", time: "now" },
        { id: "a2", text: "Execution is paused — nothing proceeds without your decision.", time: "now" },
      ],
      approvals: [
        {
          id: `approval-${revision}`,
          department: "finance",
          title: "Release vendor payment",
          detail: "Salla · 14,200 SAR · above auto-approve limit",
          risk: "HIGH",
        },
      ],
    }),
  },
  {
    id: "completed",
    label: "Job completed",
    narrative: "Success settles rather than celebrates: the node flashes complete, then relaxes back toward quiet.",
    build: (revision) => ({
      scenario: "completed",
      revision,
      narrative: "Success settles rather than celebrates: the node flashes complete, then relaxes back toward quiet.",
      visual: {
        executive: executive({ status: "ACTIVE", activityLevel: 0.22, activeJob: "Recording outcome" }),
        departments: departmentsWith([
          [
            "growth",
            {
              status: "COMPLETED",
              activityLevel: 0.25,
              activeJob: "Closed: Q3 outbound campaign",
              workerActivity: { "growth.leads": 0.3 },
            },
          ],
          [
            "client",
            {
              status: "COMPLETED",
              activityLevel: 0.14,
              activeJob: "Onboarded: Nova Group",
            },
          ],
        ]),
        handoffs: [],
      },
      activity: [
        { id: "a1", departmentId: "growth", text: "Q3 outbound campaign closed — 41 qualified leads.", time: "now" },
        { id: "a2", departmentId: "client", text: "Nova Group onboarding completed.", time: "3m" },
      ],
      approvals: [],
    }),
  },
  {
    id: "error",
    label: "Error",
    narrative: "A department failed and the Executive is escalating it — the error is visible, never hidden.",
    build: (revision) => ({
      scenario: "error",
      revision,
      narrative: "A department failed and the Executive is escalating it — the error is visible, never hidden.",
      visual: {
        executive: executive({ status: "BLOCKED", activityLevel: 0.26, activeJob: "Escalating Product & Tech failure" }),
        departments: departmentsWith([
          [
            "product",
            {
              status: "ERROR",
              activityLevel: 0.16,
              activeJob: "Failed: webhook sync (3 retries)",
              workerActivity: { "product.automation": 0.2 },
            },
          ],
        ]),
        handoffs: [],
      },
      activity: [
        { id: "a1", departmentId: "product", text: "Automation exhausted 3 retries on webhook sync.", time: "now" },
        { id: "a2", text: "Executive blocked the dependent Operations job.", time: "now" },
      ],
      approvals: [],
    }),
  },
];

export const DEMO_SCENARIOS = SCENARIOS;
export const DEFAULT_SCENARIO_ID: DemoScenarioId = "growth-active";

export function buildSnapshot(id: DemoScenarioId, revision: number): CommandVisualSnapshot {
  const scenario = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  return scenario.build(revision);
}

/** Ordered list for the Motion Lab, grouped the way a reviewer reviews. */
export const SCENARIO_ORDER: DemoScenarioId[] = [
  "idle",
  "growth-active",
  "product-active",
  "executive-thinking",
  "handoff",
  "approval",
  "completed",
  "error",
];

export { deptName };
