/**
 * NEXUP COMMAND — ACTORS (mock, Phase UI-02.1)
 * ────────────────────────────────────────────
 * The organization is not only software. Every space in COMMAND has to be able
 * to say *who is in it* — a human, an AI specialist, or both — because that is
 * what the real operating model looks like: humans hold authority, AI holds
 * throughput, and both are identifiable at a glance.
 *
 * This file is deliberately tiny and visual-only. It is NOT authentication, it
 * is NOT a permission model, and it does not read a session. Phase UI-02.1 only
 * needs a reusable *representation* of presence so the later workforce layer
 * (skills, tools, model route, memory) can hang off an actor id without the
 * spatial UI having to change.
 *
 * Design rule: an actor is identified by `kind`, never by department. A human
 * and an AI are rendered by the same component with different material, so
 * adding "AI Director" or a second human is a data change, not a UI change.
 */

/** Who/what is present. The only branch any component is allowed to make. */
export type ActorKind = "human" | "ai";

export type Actor = {
  id: string;
  /**
   * Display label — a role, never a real person's name. The mock cast is
   * deliberately anonymous so no real individual is ever named in the UI.
   */
  name: string;
  /** What they are accountable for, e.g. "Founder". */
  role: string;
  kind: ActorKind;
  /** Avatar text for humans, short code for AI. */
  initials: string;
  /** Optional identity accent (a CSS custom property name). */
  accentVar?: string;
  /**
   * Reserved for the later workforce layer (skills / tools / workflows /
   * memory / model route / permissions). Deliberately NOT read by any UI in
   * this phase — it exists so the visual component never needs to be rewritten
   * when real capability data arrives.
   */
  runtime?: {
    skills?: string[];
    tools?: string[];
    modelRoute?: string;
  };
};

export const ACTORS: Actor[] = [
  {
    id: "human-founder",
    name: "Founder",
    role: "Human authority",
    kind: "human",
    initials: "FN",
    accentVar: "--nc-human",
  },
  {
    id: "human-product-lead",
    name: "Product lead",
    role: "Product & Tech",
    kind: "human",
    initials: "PL",
    accentVar: "--nc-product",
  },
  {
    id: "human-ops-lead",
    name: "Operations lead",
    role: "Growth & Operations",
    kind: "human",
    initials: "OP",
    accentVar: "--nc-operations",
  },
  {
    id: "ai-director",
    name: "AI Director",
    role: "Department direction",
    kind: "ai",
    initials: "AI",
    accentVar: "--nc-lime",
  },
  {
    id: "ai-analyst",
    name: "AI Analyst",
    role: "Signal & reporting",
    kind: "ai",
    initials: "AN",
    accentVar: "--nc-lime",
  },
  {
    id: "ai-builder",
    name: "AI Builder",
    role: "Build & automation",
    kind: "ai",
    initials: "BU",
    accentVar: "--nc-lime",
  },
  {
    id: "ai-controller",
    name: "AI Controller",
    role: "Money & policy checks",
    kind: "ai",
    initials: "CT",
    accentVar: "--nc-lime",
  },
];

export const ACTOR_BY_ID: Record<string, Actor> = ACTORS.reduce(
  (acc, actor) => {
    acc[actor.id] = actor;
    return acc;
  },
  {} as Record<string, Actor>,
);

export function actorById(id: string): Actor | undefined {
  return ACTOR_BY_ID[id];
}

/** Resolve a list of ids, silently dropping anything unknown. */
export function actorsFrom(ids: readonly string[]): Actor[] {
  return ids.map((id) => ACTOR_BY_ID[id]).filter((actor): actor is Actor => Boolean(actor));
}

/** How many of a set of actors are AI — used for restrained language like "2 AI · 1 human". */
export function describeActors(actors: readonly Actor[]): string {
  const ai = actors.filter((actor) => actor.kind === "ai").length;
  const human = actors.length - ai;
  const parts: string[] = [];
  if (human) parts.push(`${human} human`);
  if (ai) parts.push(`${ai} AI`);
  return parts.join(" · ");
}

/**
 * The Executive itself is an actor too — it just isn't a *presence chip* on a
 * pod, it is the core of the scene. Keeping it in the same vocabulary means the
 * console, the rail and the deck can all name the same entity consistently.
 */
export const EXEC_ACTOR_ID = "ai-executive";

export const EXEC_ACTOR: Actor = {
  id: EXEC_ACTOR_ID,
  name: "Right-Hand Executive",
  role: "Central intelligence",
  kind: "ai",
  initials: "EX",
  accentVar: "--nc-lime",
};
