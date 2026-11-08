"use client";

/**
 * NEXUP COMMAND — DIRECTORY STORE (the real read)
 * ───────────────────────────────────────────────
 * The one place the two bound surfaces (`/command/clients`, `/command/projects`)
 * ask for company data. It reads the routes this application already serves —
 * `GET /api/clients`, `GET /api/projects`, `GET /api/auth/me` — and nothing else:
 * no provider, no SDK, no write path, no demo fallback.
 *
 * THREE READS, THREE STATES. Each source settles on its own, so a projects
 * failure leaves a readable clients list on screen (and vice versa) instead of
 * blanking the page or, worse, substituting the typed demo dataset. There is no
 * branch in this file that can reach `dataset` from `state/demo`: the binding is
 * a different module with its own types.
 *
 * SCOPE COMES FROM THE SESSION. The client filter never crosses companies: the
 * routes scope `/api/clients` by the session's accessible businesses and
 * `/api/projects` by `session.businessId`. The store therefore shows the session's
 * own scope (`session.business`) and ignores the shell's demo scope label, which
 * is a prototype-only control.
 *
 * STALE READS CANNOT LAND: every load carries a generation, and the reducer
 * discards a response whose generation is not current. A 401 additionally bumps
 * the generation, so reads still in flight when the session ends cannot refill
 * the page.
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
  type DirectoryState,
  type ResourceName,
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

  const generation = useRef(0);
  const inFlight = useRef(new Map<ResourceName, AbortController>());

  const load = useCallback((targets: ResourceName[]) => {
    const next = generation.current + 1;
    generation.current = next;

    const controllers = new Map<ResourceName, AbortController>();
    for (const target of targets) {
      inFlight.current.get(target)?.abort();
      const controller = new AbortController();
      controllers.set(target, controller);
      inFlight.current.set(target, controller);
    }

    dispatch({ type: "begin", generation: next, targets });

    const failed = (target: ResourceName, cause: unknown) => {
      if (isAbort(cause)) return;
      const kind = errorKind(cause);
      if (kind === "unauthorized") {
        /* The session ended mid-read: void every generation, abort the rest and
           say so once. Rows already on screen are cleared by the reducer. */
        generation.current += 1;
        for (const controller of inFlight.current.values()) controller.abort();
        dispatch({ type: "unauthorized", generation: generation.current });
        return;
      }
      dispatch({ type: "fail", generation: next, target, kind });
    };

    if (targets.includes("session")) {
      readSession(controllers.get("session")!.signal)
        .then((data) => dispatch({ type: "settle", generation: next, target: "session", data }))
        .catch((cause) => failed("session", cause));
    }

    if (targets.includes("clients")) {
      readClients(controllers.get("clients")!.signal)
        .then((data) => dispatch({ type: "settle", generation: next, target: "clients", data }))
        .catch((cause) => failed("clients", cause));
    }

    if (targets.includes("projects")) {
      readProjects(controllers.get("projects")!.signal)
        .then((data) => dispatch({ type: "settle", generation: next, target: "projects", data }))
        .catch((cause) => failed("projects", cause));
    }
  }, []);

  useEffect(() => {
    const aborts = inFlight.current;
    load(["session", "clients", "projects"]);
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, [load]);

  const reload = useCallback(() => load(["session", "clients", "projects"]), [load]);
  const reloadClients = useCallback(() => load(["clients"]), [load]);
  const reloadProjects = useCallback(() => load(["projects"]), [load]);

  const clients = useMemo(
    () => (state.clients.data ? state.clients.data.map(mapClient) : null),
    [state.clients.data],
  );
  const projects = useMemo(
    () => (state.projects.data ? state.projects.data.map(mapProject) : null),
    [state.projects.data],
  );

  const value = useMemo<DirectoryValue>(
    () => ({
      state,
      clients,
      projects,
      session: state.session.data,
      reload,
      reloadClients,
      reloadProjects,
    }),
    [state, clients, projects, reload, reloadClients, reloadProjects],
  );

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}
