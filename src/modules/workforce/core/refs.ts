/**
 * Workforce Runtime Core — identifier aliases.
 *
 * This file is a LEAF: it imports nothing. That is deliberate. Both the
 * Phase-1 engine (`modules/ai-workforce`) and the Phase-2A domain
 * (`modules/workforce`) need the same identifier vocabulary, and referencing
 * a leaf file keeps the dependency direction clean (no module cycles, not
 * even at the type level).
 *
 * The aliases are structural (`string`), exactly like Phase 1's `ToolId` /
 * `JobId`: they document intent at call sites without inventing a runtime
 * wrapper.
 */

export type ActorId = string;
export type ActorSlug = string;
export type CapabilityId = string;
export type RuntimeId = string;
export type MissionId = string;
export type TaskId = string;
export type AssignmentId = string;
export type ExecutionRecordId = string;
export type ReviewId = string;
export type TraceId = string;
