/**
 * NEXUP COMMAND — DIRECTORY READ STATE (pure reducer)
 * ───────────────────────────────────────────────────
 * Three independent reads — the session, the clients, the projects — and the
 * rules that keep them honest. Pure so they can be tested without a browser:
 *
 *   · A response is applied ONLY if it belongs to the current generation. A read
 *     that resolved after the page was reloaded, after the scope changed or after
 *     the session ended is dropped, so an old answer can never reappear under a
 *     new identity.
 *   · A failure is stored against its OWN source. One source failing does not
 *     touch the other, and it never leaves the reader looking at rows that the
 *     failed read was supposed to refresh.
 *   · A 401 is not an "error state" like the others: it clears every row and
 *     raises `unauthorized`, because a signed-out reader must not be shown the
 *     company's data at all.
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

export type DirectoryState = {
  /** Identity of the read in flight; anything older is discarded. */
  generation: number;
  unauthorized: boolean;
  session: Resource<SessionDto>;
  clients: Resource<ClientDto[]>;
  projects: Resource<ProjectDto[]>;
};

export type DirectoryAction =
  | { type: "begin"; generation: number; targets: ResourceName[] }
  | { type: "settle"; generation: number; target: "session"; data: SessionDto }
  | { type: "settle"; generation: number; target: "clients"; data: ClientDto[] }
  | { type: "settle"; generation: number; target: "projects"; data: ProjectDto[] }
  | { type: "fail"; generation: number; target: ResourceName; kind: DirectoryErrorKind }
  | { type: "unauthorized"; generation: number };

const pending = <T>(): Resource<T> => ({ state: "loading", data: null, error: null });
const cleared = <T>(): Resource<T> => ({ state: "loading", data: null, error: null });

export function initialDirectoryState(): DirectoryState {
  return {
    generation: 0,
    unauthorized: false,
    session: pending<SessionDto>(),
    clients: pending<ClientDto[]>(),
    projects: pending<ProjectDto[]>(),
  };
}

export function directoryReducer(state: DirectoryState, action: DirectoryAction): DirectoryState {
  switch (action.type) {
    case "begin": {
      const next: DirectoryState = { ...state, generation: action.generation, unauthorized: false };
      for (const target of action.targets) next[target] = pending() as never;
      return next;
    }

    case "settle": {
      /* A superseded read is discarded before anything is read from it. */
      if (action.generation !== state.generation) return state;
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
      if (action.generation !== state.generation) return state;
      if (state.unauthorized) return state;

      if (action.kind === "unauthorized") {
        /* Session gone: every row goes with it, and nothing that is still in
           flight may refill them. The provider bumps the generation when it
           sends this, so the guard above does the rest. */
        return {
          ...state,
          unauthorized: true,
          session: { state: "error", data: null, error: action.kind },
          clients: cleared<ClientDto[]>(),
          projects: cleared<ProjectDto[]>(),
        };
      }

      /* One source failed; the others keep exactly what they already had. */
      const current = state[action.target];
      const next: DirectoryState = {
        ...state,
        [action.target]: { ...current, state: "error", error: action.kind },
      };
      return next;
    }

    case "unauthorized":
      return {
        ...state,
        generation: action.generation,
        unauthorized: true,
        session: { state: "error", data: null, error: "unauthorized" },
        clients: cleared<ClientDto[]>(),
        projects: cleared<ProjectDto[]>(),
      };

    default:
      return state;
  }
}
