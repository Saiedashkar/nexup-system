"use client";

import { actorsFrom, type Actor } from "../state/actors";
import { IconAgent, IconHuman } from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * ACTOR PRESENCE — the reusable human/AI representation (Phase UI-02.1).
 *
 * One component renders a person and an agent. The only difference is material:
 * a human is a warm ivory figure, an AI is a lime-outlined agent mark. That is
 * the whole contract, and it is why a space can gain a real agent later without
 * any new component.
 *
 * Mock only: this reads `actors.ts`. It does not read a session, a permission or
 * a runtime, and it renders nothing when a space has no presence at all.
 */

/** The full form: one chip per actor, with name and role. */
export function ActorList({ ids, max = 3 }: { ids: readonly string[]; max?: number }) {
  const actors = actorsFrom(ids);
  if (actors.length === 0) return null;

  const shown = actors.slice(0, max);
  const overflow = actors.length - shown.length;

  return (
    <div className="nc-actors">
      {shown.map((actor) => (
        <ActorChip key={actor.id} actor={actor} />
      ))}
      {overflow > 0 && <span className="nc-actors__more">+{overflow}</span>}
    </div>
  );
}

export function ActorChip({ actor }: { actor: Actor }) {
  return (
    <span
      className="nc-actor"
      data-kind={actor.kind}
      style={cssVars({ "--nc-actor-accent": `var(${actor.accentVar ?? "--nc-human"})` })}
      title={`${actor.name} — ${actor.role} (${actor.kind === "ai" ? "AI agent" : "human"})`}
    >
      <span className="nc-actor__mark" aria-hidden="true">
        {actor.initials}
      </span>
      <span className="nc-actor__text">
        <span className="nc-actor__name" style={{ display: "block" }}>
          {actor.name}
        </span>
        <span className="nc-actor__role" style={{ display: "block" }}>
          {actor.role}
        </span>
      </span>
      <span className="nc-actor__kind" aria-hidden="true">
        {actor.kind === "ai" ? <IconAgent size={13} /> : <IconHuman size={13} />}
      </span>
    </span>
  );
}

/**
 * The compact form used *on* a pod: a small overlapping cluster. Humans and
 * agents are both shown, because "AI Director + a human lead" is the actual answer
 * to "who is in this space".
 */
export function ActorCluster({ ids, max = 3 }: { ids: readonly string[]; max?: number }) {
  const actors = actorsFrom(ids);
  if (actors.length === 0) return null;

  const shown = actors.slice(0, max);
  const overflow = actors.length - shown.length;

  return (
    <span className="nc-actor-cluster" aria-hidden="true">
      {shown.map((actor) => (
        <span
          key={actor.id}
          className="nc-actor-cluster__dot"
          data-kind={actor.kind}
          style={cssVars({ "--nc-actor-accent": `var(${actor.accentVar ?? "--nc-human"})` })}
        >
          {actor.initials}
        </span>
      ))}
      {overflow > 0 && <span className="nc-actor-cluster__more">+{overflow}</span>}
    </span>
  );
}
