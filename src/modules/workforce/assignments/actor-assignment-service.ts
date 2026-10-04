import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory, RiskLevel } from "@/modules/ai-workforce/core/types";
import type { ActorRegistry } from "../actors/actor-registry";
import type { CapabilityRegistry } from "../capabilities/capability-registry";
import type { CapabilityKind } from "../capabilities/capability-contracts";
import type { ActorId, AssignmentId, CapabilityId } from "../core/refs";

/**
 * Actor ↔ capability assignment.
 *
 * Assignments live OUTSIDE the Actor record on purpose. An actor is identity +
 * policy; what it may DO is a separate, revocable edge. That separation is what
 * lets the system:
 *
 *   - grant a tool / revoke a tool without touching the actor,
 *   - pin a workflow to a version (and later change it) without redefining
 *     who the actor is,
 *   - answer "which actors can run this capability?" as a query.
 *
 * Nothing here executes anything: an assignment is authority, not execution.
 */

export type CapabilityAssignmentConstraints = {
  /** The assignment is void above this risk. */
  maxRiskLevel?: RiskLevel;
  /** Force an approval for this edge regardless of the capability's own requirement. */
  requireApproval?: boolean;
  /** Restrict the grant to specific business slugs. */
  businessSlugs?: string[];
};

export type ActorCapabilityAssignment = {
  id: AssignmentId;
  actorId: ActorId;
  capabilityId: CapabilityId;
  /** Snapshot of the kind at grant time — makes the edge readable on its own. */
  capabilityKind: CapabilityKind;
  /** Pinned version; absent = follow the live version at execution time. */
  capabilityVersion?: string;
  status: "ACTIVE" | "REVOKED";
  grantedBy: string;
  grantedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  revokedReason?: string;
  constraints?: CapabilityAssignmentConstraints;
};

export type AssignmentInput = {
  actorId: ActorId;
  capabilityId: CapabilityId;
  capabilityVersion?: string;
  grantedBy: string;
  constraints?: CapabilityAssignmentConstraints;
};

export type ActorAssignmentServiceDeps = {
  actors: ActorRegistry;
  capabilities: CapabilityRegistry;
  ids: IdFactory;
  now: Clock;
};

export class ActorAssignmentService {
  private readonly rows = new Map<AssignmentId, ActorCapabilityAssignment>();

  constructor(private readonly deps: ActorAssignmentServiceDeps) {}

  /**
   * Grants a capability to an actor.
   * @throws INVALID_ASSIGNMENT when the actor or capability is unknown
   * @throws ASSIGNMENT_CONFLICT when an ACTIVE edge for the same
   *         actor+capability(+version) already exists
   */
  async assign(input: AssignmentInput): Promise<ActorCapabilityAssignment> {
    // Both references must resolve. An assignment must never point at a ghost.
    await this.deps.actors
      .require(input.actorId)
      .catch(() => {
        throw new AiWorkforceError("INVALID_ASSIGNMENT", `Cannot assign to unknown actor "${input.actorId}"`, {
          actorId: input.actorId,
        });
      });

    const capability = await this.deps.capabilities
      .require(input.capabilityId, input.capabilityVersion)
      .catch(() => {
        throw new AiWorkforceError(
          "INVALID_ASSIGNMENT",
          `Cannot assign unknown capability "${input.capabilityId}"`,
          { capabilityId: input.capabilityId },
        );
      });

    const duplicate = [...this.rows.values()].some(
      (row) =>
        row.status === "ACTIVE" &&
        row.actorId === input.actorId &&
        row.capabilityId === capability.id &&
        row.capabilityVersion === capability.version,
    );
    if (duplicate) {
      throw new AiWorkforceError(
        "ASSIGNMENT_CONFLICT",
        `Actor "${input.actorId}" already has capability "${capability.id}@${capability.version}"`,
        { actorId: input.actorId, capabilityId: capability.id, version: capability.version },
      );
    }

    const assignment: ActorCapabilityAssignment = {
      id: this.deps.ids.next("assignment"),
      actorId: input.actorId,
      capabilityId: capability.id,
      capabilityKind: capability.kind,
      capabilityVersion: capability.version,
      status: "ACTIVE",
      grantedBy: input.grantedBy,
      grantedAt: this.deps.now().toISOString(),
      constraints: input.constraints,
    };
    this.rows.set(assignment.id, assignment);
    return { ...assignment };
  }

  /**
   * Revokes an edge. Idempotent: revoking an already-revoked edge returns it.
   * @throws ASSIGNMENT_NOT_FOUND when the edge does not exist
   */
  async revoke(assignmentId: AssignmentId, by: string, reason?: string): Promise<ActorCapabilityAssignment> {
    const existing = this.rows.get(assignmentId);
    if (!existing) {
      throw new AiWorkforceError("ASSIGNMENT_NOT_FOUND", `Assignment "${assignmentId}" does not exist`, {
        assignmentId,
      });
    }
    if (existing.status === "REVOKED") return { ...existing };

    const revoked: ActorCapabilityAssignment = {
      ...existing,
      status: "REVOKED",
      revokedBy: by,
      revokedAt: this.deps.now().toISOString(),
      revokedReason: reason,
    };
    this.rows.set(revoked.id, revoked);
    return { ...revoked };
  }

  async get(assignmentId: AssignmentId): Promise<ActorCapabilityAssignment | null> {
    return this.rows.get(assignmentId) ?? null;
  }

  /** @throws ASSIGNMENT_NOT_FOUND */
  async require(assignmentId: AssignmentId): Promise<ActorCapabilityAssignment> {
    const row = await this.get(assignmentId);
    if (!row) {
      throw new AiWorkforceError("ASSIGNMENT_NOT_FOUND", `Assignment "${assignmentId}" does not exist`, {
        assignmentId,
      });
    }
    return row;
  }

  listForActor(actorId: ActorId, options: { includeRevoked?: boolean } = {}): ActorCapabilityAssignment[] {
    return [...this.rows.values()]
      .filter((row) => row.actorId === actorId && (options.includeRevoked || row.status === "ACTIVE"))
      .map((row) => ({ ...row }));
  }

  listForCapability(capabilityId: CapabilityId, options: { includeRevoked?: boolean } = {}): ActorCapabilityAssignment[] {
    return [...this.rows.values()]
      .filter((row) => row.capabilityId === capabilityId && (options.includeRevoked || row.status === "ACTIVE"))
      .map((row) => ({ ...row }));
  }

  /** True when an ACTIVE edge grants the capability (optionally at a version). */
  hasCapability(actorId: ActorId, capabilityId: CapabilityId, version?: string): boolean {
    return [...this.rows.values()].some(
      (row) =>
        row.status === "ACTIVE" &&
        row.actorId === actorId &&
        row.capabilityId === capabilityId &&
        (version === undefined || row.capabilityVersion === version),
    );
  }

  count(): number {
    return this.rows.size;
  }
}
