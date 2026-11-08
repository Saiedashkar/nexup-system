/**
 * NEXUP COMMAND — DIRECTORY BINDING, THE THREE READS
 * ──────────────────────────────────────────────────
 * No SDK, no client library and no caching layer: three same-origin GETs against
 * the routes this application already serves, wrapped so that a failure is a
 * TYPED outcome instead of a thrown string nobody can branch on.
 *
 * The distinction that matters to the UI is `unauthorized` (the session is gone:
 * stop, say so, offer the sign-in) versus everything else (the read failed: show
 * the error for THAT source, keep the other one). `network` and `server` are
 * kept apart for the same reason — an offline browser and a 500 are different
 * sentences to a reader.
 */

import type { ClientDto, ProjectDto, SessionDto } from "./types";

export type DirectoryErrorKind = "unauthorized" | "forbidden" | "server" | "network" | "shape";

export class DirectoryError extends Error {
  readonly kind: DirectoryErrorKind;
  readonly status?: number;

  constructor(kind: DirectoryErrorKind, message: string, status?: number) {
    super(message);
    this.name = "DirectoryError";
    this.kind = kind;
    this.status = status;
  }
}

/** Narrow an unknown throw into the typed kind the state machine stores. */
export function errorKind(cause: unknown): DirectoryErrorKind {
  return cause instanceof DirectoryError ? cause.kind : "network";
}

/** True only when the throw is the abort of a superseded read. */
export function isAbort(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      /* The session is a cookie; `same-origin` is enough and no header is
         invented. `no-store` keeps a stale read from being replayed after the
         session or the scope has changed. */
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    throw new DirectoryError("network", "The browser could not reach the server.");
  }

  if (response.status === 401) {
    throw new DirectoryError("unauthorized", "Your session is no longer valid.", 401);
  }
  if (response.status === 403) {
    throw new DirectoryError("forbidden", "This session cannot read that company.", 403);
  }
  if (!response.ok) {
    throw new DirectoryError("server", `The server answered ${response.status}.`, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new DirectoryError("shape", "The server answered something that is not JSON.", response.status);
  }
}

/** `GET /api/clients` — every client this session may read, with its projects. */
export function readClients(signal?: AbortSignal): Promise<ClientDto[]> {
  return readJson<ClientDto[]>("/api/clients", signal);
}

/** `GET /api/projects` — every project this session may read, with client facts. */
export function readProjects(signal?: AbortSignal): Promise<ProjectDto[]> {
  return readJson<ProjectDto[]>("/api/projects", signal);
}

/** `GET /api/auth/me` — the session itself, for the scope line the pages print. */
export async function readSession(signal?: AbortSignal): Promise<SessionDto> {
  const body = await readJson<{ user?: SessionDto }>("/api/auth/me", signal);
  if (!body || typeof body !== "object" || !body.user) {
    throw new DirectoryError("shape", "The session read had no user.");
  }
  return body.user;
}
