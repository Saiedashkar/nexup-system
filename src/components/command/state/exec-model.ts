/**
 * NEXUP COMMAND — EXEC CONFIGURATION (mock, Phase UI-05)
 * ──────────────────────────────────────────────────────
 * EXEC is the central intelligence of the organization, and it is now a
 * first-class ENTITY rather than only a button: it has its own route
 * (`/command/exec`), its own symbol, its own state vocabulary and its own
 * workspace with seven foundation areas.
 *
 * Everything here is configuration and mock content. There is no AI provider,
 * no tool runtime, no scheduler and no database access in this file — the EXEC
 * page says so out loud, exactly like every other phase of COMMAND.
 *
 * EXEC's CHARACTER is encoded as data, not styling: calm, precise, senior,
 * aware of the whole organization and protective of its business rules. The
 * six states below are the only moods EXEC is allowed to have, and each one
 * carries the note EXEC would say about itself.
 */

/* ── The six states EXEC can be in ──────────────────────────────────────── */

export type ExecStateId = "ready" | "thinking" | "routing" | "working" | "waiting" | "alert";

export type ExecState = {
  id: ExecStateId;
  /** What a human sees on the state pill. */
  label: string;
  /** The token EXEC's state light reads — one of the UI-01 runtime colours. */
  tone: string;
  /** EXEC's own one-line description of what it is doing. */
  note: string;
};

export const EXEC_STATES: ExecState[] = [
  { id: "ready", label: "READY", tone: "var(--nc-active)", note: "Steady. Listening for a direction from you." },
  { id: "thinking", label: "THINKING", tone: "var(--nc-thinking)", note: "Weighing options before it commits the organization to one." },
  { id: "routing", label: "ROUTING", tone: "var(--nc-thinking)", note: "Placing work with the department and actor that should own it." },
  { id: "working", label: "WORKING", tone: "var(--nc-lime)", note: "Work is moving. EXEC is watching it, not doing everyone's job." },
  { id: "waiting", label: "WAITING FOR YOU", tone: "var(--nc-waiting)", note: "Holding a decision that is yours to make, not its to guess." },
  { id: "alert", label: "ALERT", tone: "var(--nc-approval)", note: "Something is breaching a rule, a limit or an expectation." },
];

export function execState(id: ExecStateId): ExecState {
  return EXEC_STATES.find((state) => state.id === id) ?? EXEC_STATES[0];
}

/* ── Who EXEC is ────────────────────────────────────────────────────────── */

export const EXEC_IDENTITY = {
  name: "EXEC",
  role: "Central intelligence · NEXUP COMMAND",
  /** Never a human avatar and never a robot mascot: a built symbol. */
  sigil: "exec",
  character:
    "EXEC is the organization's senior operator. It is calm, precise and aware of every department, actor, system and rule at once. It routes work, protects the business's boundaries and never acts beyond the authority you give it.",
} as const;

/** EXEC's current read of the whole organization — mock. */
export const EXEC_STATUS = {
  state: "waiting" as ExecStateId,
  headline: "Two decisions are yours before the week can move.",
  /** What EXEC is aware of right now, at the level of a senior operator. */
  awareness: [
    { id: "deps", label: "5 departments", detail: "all reporting normally" },
    { id: "crew", label: "23 actors", detail: "19 AI · 4 human" },
    { id: "sys", label: "11 systems", detail: "connected" },
    { id: "risk", label: "2 risks", detail: "1 needs you" },
  ],
} as const;

/* ── The seven foundation areas EXEC's page is built from ───────────────── */

export type ExecIconKey =
  | "exec"
  | "spark"
  | "call"
  | "warroom"
  | "graph"
  | "repeat"
  | "stack"
  | "activity";

export type ExecAreaId = "command" | "summon" | "warroom" | "routing" | "repeating" | "context" | "activity";

export type ExecArea = {
  id: ExecAreaId;
  label: string;
  hint: string;
  icon: ExecIconKey;
};

export const EXEC_AREAS: ExecArea[] = [
  { id: "command", label: "Command", hint: "Speak to EXEC directly", icon: "spark" },
  { id: "summon", label: "Summon", hint: "Bring anyone into the conversation", icon: "call" },
  { id: "warroom", label: "War Room", hint: "A temporary room for one mission", icon: "warroom" },
  { id: "routing", label: "Mission Routing", hint: "How a goal reaches the work", icon: "graph" },
  { id: "repeating", label: "Repeating Work", hint: "Work that should keep happening", icon: "repeat" },
  { id: "context", label: "Context", hint: "What EXEC is holding in mind", icon: "stack" },
  { id: "activity", label: "Activity", hint: "What EXEC is running right now", icon: "activity" },
];

/* ── Summon — anyone EXEC can bring into a conversation ─────────────────── */

export type SummonKind = "agent" | "human" | "department" | "many";

export type SummonTarget = {
  id: string;
  kind: SummonKind;
  label: string;
  detail: string;
  /** Optional route when the target has a workspace (actors, departments). */
  href?: string;
};

export function summonKindLabel(kind: SummonKind): string {
  if (kind === "agent") return "AI agent";
  if (kind === "human") return "Human";
  if (kind === "department") return "Department";
  return "Multiple workers";
}

export const SUMMON_TARGETS: SummonTarget[] = [
  { id: "one-agent", kind: "agent", label: "AI Growth Director", detail: "Owns demand and pipeline routing", href: "/command/actors/ai-growth-director" },
  { id: "one-human", kind: "human", label: "Growth Lead", detail: "Human authority for Growth & Revenue", href: "/command/actors/growth-lead" },
  { id: "one-dept", kind: "department", label: "Growth & Revenue", detail: "The whole space, briefed together", href: "/command/departments/growth-revenue" },
  { id: "many-1", kind: "many", label: "Delivery Pod", detail: "Delivery Lead + Onboarding + QA + AI Director" },
  { id: "many-2", kind: "many", label: "Founder's Table", detail: "You + three department leads" },
];

/* ── War Room — a temporary multi-participant session ───────────────────── */

export type WarRoomSeat = { id: string; name: string; role: string; kind: SummonKind; role_in_room?: string };

export const WAR_ROOM = {
  mission: "Land the Q4 enterprise offer without discounting below 18% margin.",
  moderator: "EXEC moderates and will synthesise a decision — mocked for now.",
  seats: [
    { id: "founder", name: "Founder", role: "Human authority", kind: "human" as SummonKind },
    { id: "growth", name: "Growth Lead", role: "Demand & pipeline", kind: "human" as SummonKind },
    { id: "market", name: "Market Intelligence", role: "Positioning & pricing", kind: "agent" as SummonKind },
    { id: "product", name: "Product Lead", role: "Offer & delivery fit", kind: "human" as SummonKind },
  ],
  agenda: [
    { id: "a1", label: "Create the offer position", owner: "Market Intelligence", state: "completed" as const },
    { id: "a2", label: "Pressure-test delivery fit", owner: "Product Lead", state: "active" as const },
    { id: "a3", label: "Draft the pipeline plan", owner: "Growth Lead", state: "pending" as const },
    { id: "a4", label: "EXEC synthesis", owner: "EXEC", state: "pending" as const },
  ],
};

/* ── Mission Routing — Goal → EXEC → departments → actors → tools → output ─ */

export type RouteNodeKind = "goal" | "exec" | "department" | "actor" | "tool" | "output";

export type RouteNode = {
  id: string;
  column: number;
  label: string;
  kind: RouteNodeKind;
  detail: string;
};

export type RouteEdge = {
  from: string;
  to: string;
  state: "idle" | "active" | "routing" | "handoff" | "attention" | "completed";
};

export const MISSION_ROUTE = {
  mission: "Turn the Q4 offer into signed revenue.",
  nodes: [
    { id: "goal", column: 0, label: "Goal", kind: "goal", detail: "Signed Q4 revenue" },
    { id: "exec", column: 1, label: "EXEC", kind: "exec", detail: "Owns the route" },
    { id: "growth", column: 2, label: "Growth & Revenue", kind: "department", detail: "Demand & pipeline" },
    { id: "finance", column: 2, label: "Finance & Control", kind: "department", detail: "Margin guardrail" },
    { id: "sales", column: 3, label: "Sales Lead", kind: "actor", detail: "Closes the deal" },
    { id: "market", column: 3, label: "Market Intelligence", kind: "actor", detail: "Positions the offer" },
    { id: "crm", column: 4, label: "crm.read", kind: "tool", detail: "Pipeline data" },
    { id: "report", column: 4, label: "report.generate", kind: "tool", detail: "Offer pack" },
    { id: "signed", column: 5, label: "Signed offer", kind: "output", detail: "Revenue booked" },
  ] as RouteNode[],
  edges: [
    { from: "goal", to: "exec", state: "completed" },
    { from: "exec", to: "growth", state: "active" },
    { from: "exec", to: "finance", state: "routing" },
    { from: "growth", to: "sales", state: "active" },
    { from: "growth", to: "market", state: "active" },
    { from: "finance", to: "report", state: "attention" },
    { from: "sales", to: "crm", state: "active" },
    { from: "market", to: "report", state: "idle" },
    { from: "crm", to: "signed", state: "idle" },
    { from: "report", to: "signed", state: "idle" },
  ] as RouteEdge[],
};

/* ── Repeating Work — recurring tasks, schedules and reports (no scheduler) ─ */

export type RepeatingWork = {
  id: string;
  label: string;
  cadence: string;
  owner: string;
  state: "on" | "paused" | "watching";
  note: string;
};

export const REPEATING_WORK: RepeatingWork[] = [
  { id: "r1", label: "Monday pipeline review", cadence: "Every Monday · 08:00", owner: "AI Growth Director", state: "on", note: "Summarises movement and flags stalls." },
  { id: "r2", label: "Margin watch", cadence: "Continuous", owner: "AI Controller", state: "watching", note: "Raises ALERT if a deal drops below 18%." },
  { id: "r3", label: "Weekly client health", cadence: "Every Friday · 16:00", owner: "Client Success Lead", state: "on", note: "One page per account at risk." },
  { id: "r4", label: "Runbook coverage audit", cadence: "Monthly · 1st", owner: "Operations Lead", state: "paused", note: "Paused while processes are re-written." },
];

/* ── Context / Memory — structured mock layers, never a raw dump ────────── */

export type ContextLayer = { id: string; label: string; note: string; items: string[] };

export const CONTEXT_LAYERS: ContextLayer[] = [
  { id: "recent", label: "Recent context", note: "The last few things you and EXEC did together.", items: ["You opened the Q4 offer mission", "EXEC routed pricing to Finance", "Market Intelligence delivered a position"] },
  { id: "decisions", label: "Important decisions", note: "Standing decisions EXEC will not re-litigate.", items: ["No discounting below 18% margin", "Enterprise deals need Finance sign-off", "Client data stays inside NEXUP systems"] },
  { id: "business", label: "Active business context", note: "What is true about the business right now.", items: ["Q4 focused on enterprise", "Delivery capacity is the constraint", "Three clients renewing this quarter"] },
  { id: "memory", label: "Relevant memories", note: "Only what bears on the current mission.", items: ["Last enterprise launch slipped on onboarding", "Pricing anchor set at the March review"] },
  { id: "loaded", label: "Loaded skills & capabilities", note: "What EXEC has ready to use, not everything it knows.", items: ["mission.routing", "context.synthesis", "approval.gatekeeping", "network.read"] },
];

/* ── Activity — current jobs, routed work, approvals, handoffs, outcomes ── */

export type ActivityItem = {
  id: string;
  label: string;
  meta: string;
  state: "routing" | "handoff" | "attention" | "active" | "completed";
  when: string;
};

export const EXEC_ACTIVITY: ActivityItem[] = [
  { id: "j1", label: "Routing Q4 offer to Growth & Finance", meta: "Mission · from your last direction", state: "routing", when: "now" },
  { id: "j2", label: "Waiting on your approval: 12% discount request", meta: "Finance & Control · policy breach", state: "attention", when: "4m" },
  { id: "j3", label: "Handoff: onboarding pack to Client & Delivery", meta: "Growth → Delivery", state: "handoff", when: "18m" },
  { id: "j4", label: "Running: weekly client health report", meta: "Repeating work · AI Client Success", state: "active", when: "1h" },
  { id: "j5", label: "Outcome: runbook coverage raised to 94%", meta: "Operations floor", state: "completed", when: "3h" },
];
