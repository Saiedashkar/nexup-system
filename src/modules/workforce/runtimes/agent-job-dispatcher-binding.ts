import type { AgentDispatchResult, AgentJobDispatcher } from "@/modules/ai-workforce/jobs/job-runner";
import type { AgentRuntimeDispatcher } from "./agent-runtime-dispatcher";

/**
 * Binds the workforce `AgentRuntimeDispatcher` to the Phase-1 JobRunner's
 * optional dispatch seam.
 *
 * The two live in different modules on purpose: the runner owns a tiny,
 * runtime-agnostic function hook; the workforce module owns the registry-aware
 * orchestration. This function is the only place the two meet.
 */
export function toJobRunnerDispatcher(dispatcher: AgentRuntimeDispatcher): AgentJobDispatcher {
  return async ({ job }) => {
    const outcome = await dispatcher.dispatchJob(job);

    const result: AgentDispatchResult = { dispatched: outcome.dispatched };
    if (outcome.reason) result.reason = outcome.reason;
    if (outcome.handle?.handleId) result.handleId = outcome.handle.handleId;
    if (outcome.output !== undefined) result.output = outcome.output;
    if (outcome.status) result.status = outcome.status;
    if (outcome.error) result.error = { code: outcome.error.code, message: outcome.error.message };
    return result;
  };
}
