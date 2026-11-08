/**
 * THE FIRST REAL BINDING — mapping and read-state rules, without a browser.
 *
 * What these tests are for: the two bound surfaces must never show a value the
 * database does not store, must never show a row before the session and its scope
 * are proven, and must never let a superseded request — a retried one, or a dying
 * one answering 401 — decide anything. All of those are properties of the pure
 * mapping and of the read reducer, so they are asserted here rather than inferred
 * from a screenshot.
 */

import { describe, expect, it } from "vitest";

import {
  amount,
  directoryTotals,
  mapClient,
  mapProject,
  paidRatio,
  paymentStatusOf,
  tierOf,
  workStatusOf,
} from "@/components/command/state/directory/mapping";
import {
  directoryReducer,
  initialDirectoryState,
  rowsVisible,
  scopeKey,
  type DirectoryState,
  type ResourceName,
} from "@/components/command/state/directory/reducer";
import type {
  ClientDto,
  ProjectDto,
  SessionDto,
} from "@/components/command/state/directory/types";

const clientDto: ClientDto = {
  id: "c1",
  name: "متجر سلة",
  phone: "0500000000",
  tier: "VIP",
  projectRecords: [
    {
      id: "p1",
      projectName: "واجهة متجر",
      totalPrice: "1000.00",
      deposit: "400.00",
      workStatus: "IN_PROGRESS",
      paymentStatus: "PARTIAL",
      date: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "p2",
      projectName: "تحسين تحويل",
      totalPrice: "500.00",
      deposit: "500.00",
      workStatus: "COMPLETED",
      paymentStatus: "FULL",
      date: "2026-02-02T00:00:00.000Z",
    },
  ],
  projectCount: 2,
  totalPaid: 900,
  totalRemaining: 600,
  isRepeatClient: true,
};

const projectDto: ProjectDto = {
  id: "p1",
  businessId: "b1",
  clientId: "c1",
  projectName: "واجهة متجر",
  date: "2026-01-02T00:00:00.000Z",
  totalPrice: "1000.00",
  deposit: "400.00",
  remaining: "600.00",
  workStatus: "IN_PROGRESS",
  paymentStatus: "PARTIAL",
  designerName: "  ",
  services: [{ id: "s1", name: "تصميم واجهة" }],
  client: { id: "c1", name: "متجر سلة", phone: "0500000000", projectCount: 2 },
  notes: null,
};

const sessionDto: SessionDto = {
  userId: "u1",
  name: "سالم",
  role: "ADMIN",
  businessId: "b1",
  business: { id: "b1", name: "NEXUP", slug: "nexup" },
  scope: { mode: "companies", businesses: [{ id: "b1", name: "NEXUP", slug: "nexup" }] },
  canAccessNexup: true,
  canAccessRebound: false,
  canAccessAbomazen: false,
};

describe("money and vocabulary", () => {
  it("parses Decimal strings and refuses to produce NaN", () => {
    expect(amount("1000.00")).toBe(1000);
    expect(amount(12.5)).toBe(12.5);
    expect(amount("not money")).toBe(0);
    expect(amount(null)).toBe(0);
    expect(amount(undefined)).toBe(0);
  });

  it("returns null for a status or tier the database does not declare", () => {
    expect(workStatusOf("ARCHIVED")).toBeNull();
    expect(workStatusOf("PAUSED")).toBe("PAUSED");
    expect(paymentStatusOf("HALF")).toBeNull();
    expect(paymentStatusOf("PARTIAL")).toBe("PARTIAL");
    expect(tierOf("GOLD")).toBeNull();
    expect(tierOf("DELINQUENT")).toBe("DELINQUENT");
  });

  it("clamps the collected share and treats a zero total as no ratio", () => {
    expect(paidRatio(400, 1000)).toBe(40);
    expect(paidRatio(1500, 1000)).toBe(100);
    expect(paidRatio(0, 0)).toBe(0);
  });
});

describe("client mapping", () => {
  it("carries only stored facts — no owner, industry, health score or missions", () => {
    const view = mapClient(clientDto);
    expect(view.id).toBe("c1");
    expect(view.phone).toBe("0500000000");
    expect(view.tier).toBe("VIP");
    expect(view.projectCount).toBe(2);
    expect(view.paidRatio).toBe(60);
    expect(view.projects.map((p) => p.id)).toEqual(["p1", "p2"]);

    for (const invented of ["owner", "industry", "since", "healthScore", "openItems", "missionIds", "status", "note"]) {
      expect(invented in view).toBe(false);
    }
  });

  it("shows the STORED tier even when the route also sends a derived one", () => {
    const view = mapClient({ ...clientDto, tier: "VIP", computedTier: "NORMAL" });
    expect(view.tier).toBe("VIP");
    expect(directoryTotals([view]).byTier("VIP")).toBe(1);
    expect(directoryTotals([view]).byTier("NORMAL")).toBe(0);
  });

  it("derives the totals from the embedded projects when the route omits them", () => {
    const withoutRouteTotals: ClientDto = { ...clientDto, projectCount: undefined, totalPaid: undefined, totalRemaining: undefined };
    const view = mapClient(withoutRouteTotals);
    expect(view.total).toBe(1500);
    expect(view.paid).toBe(900);
    expect(view.remaining).toBe(600);
    expect(view.projectCount).toBe(2);
    expect(view.isRepeat).toBe(true);
  });

  it("keeps every client's money non-negative in the directory totals", () => {
    const overpaid = mapClient({ ...clientDto, totalRemaining: -250 });
    const totals = directoryTotals([mapClient(clientDto), overpaid]);
    expect(totals.clients).toBe(2);
    expect(totals.outstanding).toBe(600);
    expect(totals.byTier("VIP")).toBe(2);
  });
});

describe("project mapping", () => {
  it("keeps the stored designer only when there is one, and the stored services", () => {
    const view = mapProject(projectDto);
    expect(view.designer).toBeNull();
    expect(view.services).toEqual(["تصميم واجهة"]);
    expect(view.paidRatio).toBe(40);
    expect(view.clientName).toBe("متجر سلة");
    expect(view.clientProjectCount).toBe(2);
  });

  it("falls back to the free-text service, which is also a stored field", () => {
    const view = mapProject({ ...projectDto, services: [], customServiceText: "موقع تعريفي" });
    expect(view.services).toEqual(["موقع تعريفي"]);
    const empty = mapProject({ ...projectDto, services: [], customServiceText: null });
    expect(empty.services).toEqual([]);
  });

  it("names the designer record over the legacy free-text column", () => {
    const view = mapProject({ ...projectDto, designer: { id: "u1", name: "سارة" } });
    expect(view.designer).toBe("سارة");
  });
});

/* ── Read state: ordering of completions, not just their values ──────────── */

const EPOCH = 0;

const begin = (state: DirectoryState, target: ResourceName, stamp: number, epoch = EPOCH) =>
  directoryReducer(state, { type: "begin", epoch, target, stamp });

const allStarted = (epoch = EPOCH): DirectoryState => {
  let state = initialDirectoryState();
  state = begin(state, "session", 1, epoch);
  state = begin(state, "clients", 1, epoch);
  state = begin(state, "projects", 1, epoch);
  return state;
};

const settleSession = (state: DirectoryState, stamp: number, data: SessionDto, epoch = EPOCH) =>
  directoryReducer(state, { type: "settle", epoch, target: "session", stamp, data });

const settleClients = (state: DirectoryState, stamp: number, data: ClientDto[], epoch = EPOCH) =>
  directoryReducer(state, { type: "settle", epoch, target: "clients", stamp, data });

const settleProjects = (state: DirectoryState, stamp: number, data: ProjectDto[], epoch = EPOCH) =>
  directoryReducer(state, { type: "settle", epoch, target: "projects", stamp, data });

const fail = (
  state: DirectoryState,
  target: ResourceName,
  stamp: number,
  kind: Parameters<typeof directoryReducer>[1] extends infer A
    ? A extends { type: "fail"; kind: infer K }
      ? K
      : never
    : never,
  epoch = EPOCH,
) => directoryReducer(state, { type: "fail", epoch, target, stamp, kind });

describe("read state — one source per request", () => {
  it("lets one source fail without touching the other", () => {
    let state = allStarted();
    state = settleClients(state, 1, [clientDto]);
    state = fail(state, "projects", 1, "server");

    expect(state.clients.state).toBe("ready");
    expect(state.clients.data).toHaveLength(1);
    expect(state.projects.state).toBe("error");
    expect(state.projects.error).toBe("server");
    expect(state.unauthorized).toBe(false);
  });

  it("retries ONE source without voiding the requests still in flight", () => {
    let state = allStarted();
    /* the projects and session requests are still loading when clients retries */
    state = begin(state, "clients", 2);

    const settledProjects = settleProjects(state, 1, [projectDto]);
    expect(settledProjects.projects.state).toBe("ready");
    expect(settledProjects.projects.data).toHaveLength(1);

    const settledSession = settleSession(settledProjects, 1, sessionDto);
    expect(settledSession.session.state).toBe("ready");
    expect(rowsVisible(settledSession)).toBe(true);

    /* the answer to the REPLACED clients request must not land */
    const staleClients = settleClients(settledSession, 1, []);
    expect(staleClients.clients.state).toBe("loading");
    expect(staleClients.clients.data).toBeNull();

    const freshClients = settleClients(staleClients, 2, [clientDto]);
    expect(freshClients.clients.state).toBe("ready");
    expect(freshClients.clients.data).toHaveLength(1);
  });

  it("ignores a 401 from a request that was already replaced", () => {
    let state = allStarted();
    state = begin(state, "clients", 2);
    state = settleClients(state, 2, [clientDto]);
    state = settleSession(state, 1, sessionDto);

    const stale = fail(state, "clients", 1, "unauthorized");

    expect(stale.unauthorized).toBe(false);
    expect(stale.clients.state).toBe("ready");
    expect(stale.clients.data).toHaveLength(1);
    expect(rowsVisible(stale)).toBe(true);
  });

  it("ends the session when the CURRENT request answers 401, and voids what was in flight", () => {
    let state = allStarted();
    state = settleClients(state, 1, [clientDto]);
    state = settleProjects(state, 1, [projectDto]);
    state = settleSession(state, 1, sessionDto);

    const ended = fail(state, "projects", 1, "unauthorized");

    expect(ended.unauthorized).toBe(true);
    expect(ended.clients.data).toBeNull();
    expect(ended.projects.data).toBeNull();
    expect(ended.session.data).toBeNull();
    expect(rowsVisible(ended)).toBe(false);

    /* anything that was still in flight is stale now, even at the same stamp */
    const late = settleClients(ended, 1, [clientDto]);
    expect(late.clients.data).toBeNull();
    expect(late.unauthorized).toBe(true);
  });

  it("only moves the epoch through an invalidation, then drops the old answers", () => {
    let state = allStarted(0);
    state = settleClients(state, 1, [clientDto]);

    /* a begin for some other epoch is not how the page identity changes */
    const ignored = begin(state, "clients", 1, 1);
    expect(ignored.epoch).toBe(0);
    expect(ignored.clients.state).toBe("ready");

    const invalidated = directoryReducer(ignored, { type: "invalidate", epoch: 1 });
    const restarted = begin(invalidated, "clients", 2, 1);
    const stale = settleClients(restarted, 1, [], 0);

    expect(stale.epoch).toBe(1);
    expect(stale.clients.state).toBe("loading");
    expect(stale.clients.data).toBeNull();

    const fresh = settleClients(stale, 2, [clientDto], 1);
    expect(fresh.clients.data).toHaveLength(1);
  });
});

describe("read state — nothing before the session is proven", () => {
  it("hides rows that arrived before the session answered", () => {
    let state = allStarted();
    state = settleClients(state, 1, [clientDto]);
    state = settleProjects(state, 1, [projectDto]);

    expect(state.clients.state).toBe("ready");
    expect(rowsVisible(state)).toBe(false);

    const proven = settleSession(state, 1, sessionDto);
    expect(rowsVisible(proven)).toBe(true);
    expect(state.clients.data).toHaveLength(1);
  });

  it("keeps rows hidden when the session read fails", () => {
    let state = allStarted();
    state = settleClients(state, 1, [clientDto]);
    state = fail(state, "session", 1, "forbidden");

    expect(state.session.state).toBe("error");
    expect(rowsVisible(state)).toBe(false);
  });

  it("keeps rows hidden when the session ends", () => {
    let state = allStarted();
    state = settleSession(state, 1, sessionDto);
    state = fail(state, "clients", 1, "unauthorized");
    expect(rowsVisible(state)).toBe(false);
  });
});

describe("read state — the scope moved", () => {
  const otherScope: SessionDto = {
    ...sessionDto,
    userId: "u2",
    businessId: "b2",
    business: { id: "b2", name: "ABOMAZEN", slug: "abomazen" },
    scope: { mode: "companies", businesses: [{ id: "b2", name: "ABOMAZEN", slug: "abomazen" }] },
    canAccessNexup: false,
    canAccessAbomazen: true,
  };

  it("changes the identity key when the session's companies change", () => {
    expect(scopeKey(sessionDto)).not.toBe(scopeKey(otherScope));
  });

  it("voids every row and every in-flight read on invalidation", () => {
    let state = allStarted();
    state = settleSession(state, 1, sessionDto);
    state = settleClients(state, 1, [clientDto]);
    state = settleProjects(state, 1, [projectDto]);

    const invalidated = directoryReducer(state, { type: "invalidate", epoch: 1 });

    expect(invalidated.epoch).toBe(1);
    expect(invalidated.clients.state).toBe("loading");
    expect(invalidated.projects.state).toBe("loading");
    /* the freshly settled session is the proof for the new scope, so it stays;
       the company rows it vouched for do not */
    expect(invalidated.session.state).toBe("ready");
    expect(rowsVisible(invalidated)).toBe(true);
    expect(invalidated.clients.data).toBeNull();

    /* the old reads answer after the change: dropped */
    expect(settleClients(invalidated, 1, [clientDto], 1).clients.data).toBeNull();
    expect(settleProjects(invalidated, 1, [projectDto], 0).projects.data).toBeNull();
  });
});

describe("read state — initial shape", () => {
  it("starts with an identity stamp per source and no session", () => {
    const state = initialDirectoryState();
    expect(state.stamps).toEqual({ session: 0, clients: 0, projects: 0 });
    expect(state.epoch).toBe(0);
    expect(rowsVisible(state)).toBe(false);
  });
});
