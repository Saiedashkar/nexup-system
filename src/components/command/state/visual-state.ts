/**
 * NEXUP COMMAND — VISUAL STATE CONTRACT (Phase UI-01)
 * ─────────────────────────────────────────────────────
 * The single most important rule of the Command UI:
 *
 *     visual state !== business state.
 *
 * Nothing in this file knows about Growth, jobs, Prisma, or approvals. It
 * describes only *how something looks while it is doing something*. Any
 * department, agent, mission, company — or later, a real job-runner event —
 * can be mapped onto these nine states, and the visual layer reacts the same
 * way every time.
 *
 * A node component therefore receives props, never instructions:
 *   status · activityLevel · activeJob · needsApproval · handoffTarget
 */

/** The nine runtime visual states a node can be in. */
export type NodeVisualStatus =
  | "IDLE"
  | "THINKING"
  | "ACTIVE"
  | "HANDOFF"
  | "WAITING"
  | "APPROVAL_REQUIRED"
  | "BLOCKED"
  | "COMPLETED"
  | "ERROR";

/**
 * The prop contract handed to every node in the organization. Deliberately
 * flat and serialisable so a real runtime event stream can produce it later
 * without touching the visual layer.
 */
export type NodeVisualProps = {
  /** Runtime state. Drives colour, ring behaviour and attention level. */
  status: NodeVisualStatus;
  /** 0..1 — how much work is flowing through this node right now. */
  activityLevel: number;
  /** Human-readable current work, e.g. "Qualifying 42 inbound leads". */
  activeJob?: string | null;
  /** True when this node is explicitly asking a human to decide. */
  needsApproval?: boolean;
  /** Where this node is delegating to, if anywhere. */
  handoffTarget?: string | null;
};

/** Full visual state for one node, including per-worker detail. */
export type VisualNodeState = NodeVisualProps & {
  /** workerId → 0..1 activity. Used by the department zoom view. */
  workerActivity?: Record<string, number>;
};

/** A signal travelling from one node to another (rendered as travel motion). */
export type HandoffSignal = {
  /** Unique per emit so repeating a handoff replays the animation. */
  id: string;
  from: string;
  to: string;
};

/** The whole organization as the visual layer sees it. */
export type OrganizationVisualState = {
  executive: VisualNodeState;
  departments: Record<string, VisualNodeState>;
  handoffs: HandoffSignal[];
};

/* ── Pure helpers ───────────────────────────────────────────────────────── */

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** An entirely calm node. Idle is the default, and idle is quiet. */
export const idleNode = (): VisualNodeState => ({
  status: "IDLE",
  activityLevel: 0,
  activeJob: null,
  needsApproval: false,
  handoffTarget: null,
  workerActivity: {},
});

/** Statuses that mean "work is actually happening" (line gets live treatment). */
export const isWorkingStatus = (status: NodeVisualStatus) =>
  status === "ACTIVE" || status === "THINKING" || status === "HANDOFF";

/** Statuses that mean "a human is the blocker". */
export const needsHumanStatus = (status: NodeVisualStatus) =>
  status === "APPROVAL_REQUIRED" || status === "BLOCKED" || status === "ERROR";

/**
 * The four phases the Intelligence Core can *look* like. The nine runtime
 * states collapse into these because a core that says "Handing off" is really
 * saying "Running" — the vocabulary belongs to the core's own presence, and the
 * operational detail stays in the rail, the list and the console.
 */
export type ExecPhase = "ready" | "thinking" | "running" | "waiting";

export const EXEC_PHASE_LABEL: Record<ExecPhase, string> = {
  ready: "Ready",
  thinking: "Thinking",
  running: "Running",
  waiting: "Waiting for You",
};

/** Map any runtime state onto a core phase. No department-specific branches. */
export function execPhase(status: NodeVisualStatus): ExecPhase {
  switch (status) {
    case "THINKING":
      return "thinking";
    case "ACTIVE":
    case "HANDOFF":
      return "running";
    case "WAITING":
    case "APPROVAL_REQUIRED":
    case "BLOCKED":
    case "ERROR":
      return "waiting";
    default:
      return "ready";
  }
}

/** Restrained, non-alarming labels — this is an operating environment. */
export const STATUS_LABEL: Record<NodeVisualStatus, string> = {
  IDLE: "Idle",
  THINKING: "Thinking",
  ACTIVE: "Working",
  HANDOFF: "Handing off",
  WAITING: "Waiting",
  APPROVAL_REQUIRED: "Needs approval",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  ERROR: "Error",
};

/** Worker-level states are the same vocabulary, collapsed for a person row. */
export type WorkerVisualState = "IDLE" | "WORKING" | "ACTIVE" | "WAITING" | "APPROVAL_REQUIRED";

export const workerState = (level: number): WorkerVisualState => {
  if (level >= 0.66) return "ACTIVE";
  if (level >= 0.25) return "WORKING";
  if (level > 0) return "WAITING";
  return "IDLE";
};

/** Coarse level used for the little worker dots on a department node. */
export const workerLevel = (level: number): "none" | "mid" | "high" => {
  if (level >= 0.66) return "high";
  if (level >= 0.25) return "mid";
  return "none";
};

/** Cheap, human-facing roll-up of the whole organization. */
export function summarizeOrganization(visual: OrganizationVisualState) {
  const nodes = [visual.executive, ...Object.values(visual.departments)];
  return {
    working: nodes.filter((n) => isWorkingStatus(n.status)).length,
    needsHuman: nodes.filter((n) => n.needsApproval || needsHumanStatus(n.status)).length,
    activeHandoffs: visual.handoffs.length,
  };
}
