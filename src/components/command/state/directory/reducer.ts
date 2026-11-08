/**
 * NEXUP COMMAND — DIRECTORY READ STATE (pure reducer)
 * ───────────────────────────────────────────────────
 * Three independent reads — the session, the clients, the projects — and the
 * rules that keep them honest. Pure so they can be tested without a browser:
 *
 *   · EACH SOURCE HAS ITS OWN IDENTITY. Every read carries a `stamp`, and every
 *     source keeps its own counter, so retrying the clients does not invalidate
 *     the projects request that is still in flight (it used to: one shared
 *     generation meant any retry voided every other read).
 *   · A RESPONSE IS APPLIED ONLY IF IT IS STILL THE CURRENT ONE: its stamp must
 *     match the source's stamp and its `epoch` must match the state's. That is
 *     what drops a read that resolved after the session moved, after the scope
 *     changed, or after the same source was retried.
 *   · A 401 IS ONLY A SESSION END WHEN IT COMES FROM THE CURRENT REQUEST. A stale
 *     401 — the answer to a read that has already been replaced — is discarded
 *     like any other stale answer; otherwise a dying request could sign a healthy
 *     page out.
 *   · DATA IS NOT SHOWN BEFORE THE SESSION IS PROVEN. Clients and projects may
 *     arrive first (they are requested in parallel), but `rowsVisible` stays false
 *     until `/api/auth/me` answers, and a session failure keeps it false.
 */

import type { DirectoryErrorKind } from "./api";
import type { ClientDto, ProjectDto, SessionDto } from "./types";

export type ResourceName = "session" | "clients" | "projects";

export type ResourceState = "loading" | "ready" | "empty" | "error";

export type Resource<T> = {
  state: ResourceState;
  data: T | null;
  /** The kind of the last failure, for the surface's own wording. */
  error: DirectoryErrorKind | null;
};

/** One counter per source: a retry only moves its own. */
export type Stamps = Record<ResourceName, number>;

export type DirectoryState = {
  /** Bumped when the session identity or its scope changes: voids every read. */
  epoch: number;
  stamps: Stamps;
  unauthorized: boolean;
  session: Resource<SessionDto>;
  clients: Resource<ClientDto[]>;
  projects: Resource<ProjectDto[]>;
};

export type DirectoryAction =
  | { type: "begin"; epoch: number; target: ResourceName; stamp: number }
  | { type: "settle"; epoch: number; target: "session"; stamp: number; data: SessionDto }
  | { type: "settle"; epoch: number; target: "clients"; stamp: number; data: ClientDto[] }
  | { type: "settle"; epoch: number; target: "projects"; stamp: number; data: ProjectDto[] }
  | { type: "fail"; epoch: number; target: ResourceName; stamp: number; kind: DirectoryErrorKind }
  | { type: "unauthorized"; epoch: number }
  | { type: "invalidate"; epoch: number };

const pending = <T>(): Resource<T> => ({ state: "loading", data: null, error: null });
const cleared = <T>(): Resource<T> => ({ state: "loading", data: null, error: null });

export function initialDirectoryState(): DirectoryState {
  return {
    epoch: 0,
    stamps: { session: 0, clients: 0, projects: 0 },
    unauthorized: false,
    session: pending<SessionDto>(),
    clients: pending<ClientDto[]>(),
    projects: pending<ProjectDto[]>(),
  };
}

/** The identity of a session, for deciding whether the scope moved under us. */
export function scopeKey(session: SessionDto): string {
  const companies = session.scope
    ? session.scope.mode === "all"
      ? ["*"]
      : session.scope.businesses.map((business) => business.id)
    : [session.businessId];
  return [session.userId, session.role, ...companies.slice().sort()].join("|");
}

/** Rows may only be read once the session has answered `ready`. */
export function rowsVisible(state: DirectoryState): boolean {
  return !state.unauthorized && state.session.state === "ready";
}

function bumpAll(stamps: Stamps): Stamps {
  return {
    session: stamps.session + 1,
    clients: stamps.clients + 1,
    projects: stamps.projects + 1,
  };
}

function isCurrent(
  state: DirectoryState,
  action: { epoch: number; target: ResourceName; stamp: number },
): boolean {
  return action.epoch === state.epoch && action.stamp === state.stamps[action.target];
}

export function directoryReducer(state: DirectoryState, action: DirectoryAction): DirectoryState {
  switch (action.type) {
    case "begin": {
      /* A read started under an older epoch must not resurrect itself. */
      if (action.epoch !== state.epoch) return state;
      if (state.unauthorized) return state;
      return {
        ...state,
        stamps: { ...state.stamps, [action.target]: action.stamp },
        [action.target]: pending(),
      } as DirectoryState;
    }

    case "settle": {
      if (!isCurrent(state, action)) return state;
      if (state.unauthorized) return state;

      if (action.target === "session") {
        return { ...state, session: { state: "ready", data: action.data, error: null } };
      }
      if (action.target === "clients") {
        return {
          ...state,
          clients: {
            state: action.data.length ? "ready" : "empty",
            data: action.data,
            error: null,
          },
        };
      }
      return {
        ...state,
        projects: {
          state: action.data.length ? "ready" : "empty",
          data: action.data,
          error: null,
        },
      };
    }

    case "fail": {
      if (!isCurrent(state, action)) return state;
      if (state.unauthorized) return state;

      if (action.kind === "unauthorized") {
        return {
          ...state,
          epoch: action.epoch + 1,
          stamps: bumpAll(state.stamps),
          unauthorized: true,
          session: { state: "error", data: null, error: action.kind },
          clients: cleared<ClientDto[]>(),
          projects: cleared<ProjectDto[]>(),
        };
      }

      /* One source failed; the others keep exactly what they already had. */
      return {
        ...state,
        [action.target]: { ...state[action.target], state: "error", error: action.kind },
      };
    }

    case "unauthorized":
      return {
        ...state,
        epoch: action.epoch,
        stamps: bumpAll(state.stamps),
        unauthorized: true,
        session: { state: "error", data: null, error: "unauthorized" },
        clients: cleared<ClientDto[]>(),
        projects: cleared<ProjectDto[]>(),
      };

    case "invalidate":
      /* The session's identity or scope changed: the session itself stays (it is
         the proof), every company row goes, and in-flight answers become stale. */
      return {
        ...state,
        epoch: action.epoch,
        stamps: bumpAll(state.stamps),
        unauthorized: false,
        clients: pending<ClientDto[]>(),
        projects: pending<ProjectDto[]>(),
      };

    default:
      return state;
  }
}
