"use client";

/**
 * NEXUP COMMAND — DIRECTORY STORE (the real read)
 * ───────────────────────────────────────────────
 * The one place the two bound surfaces (`/command/clients`, `/command/projects`)
 * ask for company data. It reads the routes this application already serves —
 * `GET /api/clients`, `GET /api/projects`, `GET /api/auth/me` — and nothing else:
 * no provider, no SDK, no write path, no demo fallback.
 *
 * THREE READS, THREE REQUESTS. Every source has its own `AbortController`, its
 * own stamp and its own settle/fail path, so retrying the clients leaves the
 * projects and session requests untouched. Only a change of session identity or
 * scope — or a 401 from a CURRENT request — aborts and voids all of them.
 *
 * NOTHING IS SHOWN BEFORE THE SESSION IS PROVEN. The rows are exposed only while
 * `rowsVisible(state)` is true, i.e. after `/api/auth/me` answered; a session
 * failure exposes no rows at all, even if the company data already arrived.
 *
 * STALE ANSWERS ARE DROPPED, INCLUDING STALE 401s. A response whose stamp is not
 * the source's current stamp (or whose epoch is old) is discarded before it is
 * looked at — a dying request cannot sign the page out.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { errorKind, isAbort, readClients, readProjects, readSession } from "./api";
import { mapClient, mapProject, type ClientView, type ProjectView } from "./mapping";
import {
  directoryReducer,
  initialDirectoryState,
  rowsVisible,
  scopeKey,
  type DirectoryState,
  type ResourceName,
  type Stamps,
} from "./reducer";
import type { SessionDto } from "./types";

export type DirectoryValue = {
  state: DirectoryState;
  /** Mapped rows, or `null` while that source has not answered. */
  clients: ClientView[] | null;
  projects: ProjectView[] | null;
  session: SessionDto | null;
  /** Re-read every source (the retry control on the page). */
  reload: () => void;
  reloadSession: () => void;
  reloadClients: () => void;
  reloadProjects: () => void;
};

const DirectoryContext = createContext<DirectoryValue | null>(null);

export function useDirectory(): DirectoryValue {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return ctx;
}

export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(directoryReducer, undefined, initialDirectoryState);

  const epoch = useRef(0);
  const stamps = useRef<Stamps>({ session: 0, clients: 0, projects: 0 });
  const inFlight = useRef(new Map<ResourceName, AbortController>());
  const scope = useRef<string | null>(null);

  /* The session ended under a current request: void everything at once. */
  const endSession = useCallback(() => {
    epoch.current += 1;
    for (const controller of inFlight.current.values()) controller.abort();
    inFlight.current.clear();
    stamps.current = {
      session: stamps.current.session + 1,
      clients: stamps.current.clients + 1,
      projects: stamps.current.projects + 1,
    };
    scope.current = null;
    dispatch({ type: "unauthorized", epoch: epoch.current });
  }, []);

  const load = useCallback(
    (targets: ResourceName[]) => {
      const currentEpoch = epoch.current;

      for (const target of targets) {
        /* Only THIS source is replaced; its siblings keep their requests. */
        inFlight.current.get(target)?.abort();
        const stamp = stamps.current[target] + 1;
        stamps.current = { ...stamps.current, [target]: stamp };

        const controller = new AbortController();
        inFlight.current.set(target, controller);
        dispatch({ type: "begin", epoch: currentEpoch, target, stamp });

        const isCurrent = () =>
          epoch.current === currentEpoch && stamps.current[target] === stamp;

        const fail = (cause: unknown) => {
          /* Aborted, or superseded: not an outcome of the current read. A stale
             401 lands here and is dropped instead of ending the session. */
          if (isAbort(cause) || !isCurrent()) return;
          const kind = errorKind(cause);
          if (kind === "unauthorized") {
            endSession();
            return;
          }
          dispatch({ type: "fail", epoch: currentEpoch, target, stamp, kind });
        };

        if (target === "session") {
          readSession(controller.signal)
            .then((data) => {
              if (!isCurrent()) return;
              const key = scopeKey(data);
              const moved = scope.current !== null && scope.current !== key;
              scope.current = key;
              dispatch({ type: "settle", epoch: currentEpoch, target: "session", stamp, data });
              if (!moved) return;
              /* The session now describes different companies: every row and every
                 in-flight request from the old scope is void, and the reads start
                 again under the new epoch. */
              epoch.current += 1;
              for (const other of inFlight.current.values()) other.abort();
              inFlight.current.clear();
              stamps.current = {
                session: stamps.current.session + 1,
                clients: stamps.current.clients + 1,
                projects: stamps.current.projects + 1,
              };
              dispatch({ type: "invalidate", epoch: epoch.current });
            })
            .catch(fail);
        } else if (target === "clients") {
          readClients(controller.signal)
            .then((data) => {
              if (!isCurrent()) return;
              dispatch({ type: "settle", epoch: currentEpoch, target: "clients", stamp, data });
            })
            .catch(fail);
        } else {
          readProjects(controller.signal)
            .then((data) => {
              if (!isCurrent()) return;
              dispatch({ type: "settle", epoch: currentEpoch, target: "projects", stamp, data });
            })
            .catch(fail);
        }
      }
    },
    [endSession],
  );

  useEffect(() => {
    const aborts = inFlight.current;
    load(["session", "clients", "projects"]);
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, [load]);

  /* A scope change invalidates the company reads; the new epoch starts them. */
  const lastEpoch = useRef(0);
  useEffect(() => {
    if (state.epoch === lastEpoch.current) return;
    lastEpoch.current = state.epoch;
    if (state.epoch > 0 && !state.unauthorized && state.session.state === "ready") {
      load(["clients", "projects"]);
    }
  }, [state.epoch, state.unauthorized, state.session.state, load]);

  const reload = useCallback(() => load(["session", "clients", "projects"]), [load]);
  const reloadSession = useCallback(() => load(["session"]), [load]);
  const reloadClients = useCallback(() => load(["clients"]), [load]);
  const reloadProjects = useCallback(() => load(["projects"]), [load]);

  const visible = rowsVisible(state);
  const clients = useMemo(
    () => (visible && state.clients.data ? state.clients.data.map(mapClient) : null),
    [visible, state.clients.data],
  );
  const projects = useMemo(
    () => (visible && state.projects.data ? state.projects.data.map(mapProject) : null),
    [visible, state.projects.data],
  );

  const value = useMemo<DirectoryValue>(
    () => ({
      state,
      clients,
      projects,
      session: state.session.data,
      reload,
      reloadSession,
      reloadClients,
      reloadProjects,
    }),
    [state, clients, projects, reload, reloadSession, reloadClients, reloadProjects],
  );

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}
