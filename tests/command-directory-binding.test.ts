/**
 * THE FIRST REAL BINDING — mapping and read-state rules, without a browser.
 *
 * What these tests are for: the two bound surfaces must never show a value the
 * database does not store, and a failed read must never be papered over with a
 * demo row. Both of those are properties of the pure mapping and of the read
 * reducer, so they can be asserted here rather than inferred from a screenshot.
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
  type DirectoryState,
} from "@/components/command/state/directory/reducer";
import type { ClientDto, ProjectDto } from "@/components/command/state/directory/types";

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

describe("read state", () => {
  const begin = (generation: number): DirectoryState =>
    directoryReducer(initialDirectoryState(), {
      type: "begin",
      generation,
      targets: ["session", "clients", "projects"],
    });

  it("lets one source fail without touching the other", () => {
    let state = begin(1);
    state = directoryReducer(state, { type: "settle", generation: 1, target: "clients", data: [clientDto] });
    state = directoryReducer(state, { type: "fail", generation: 1, target: "projects", kind: "server" });

    expect(state.clients.state).toBe("ready");
    expect(state.clients.data).toHaveLength(1);
    expect(state.projects.state).toBe("error");
    expect(state.projects.error).toBe("server");
    expect(state.unauthorized).toBe(false);
  });

  it("drops a response that belongs to a superseded read", () => {
    let state = begin(1);
    state = directoryReducer(state, { type: "settle", generation: 1, target: "clients", data: [clientDto] });
    state = directoryReducer(state, { type: "begin", generation: 2, targets: ["clients", "projects"] });
    state = directoryReducer(state, { type: "settle", generation: 1, target: "clients", data: [] });

    expect(state.clients.state).toBe("loading");
    expect(state.clients.data).toBeNull();
  });

  it("clears every row when the session ends, and ignores what was already in flight", () => {
    let state = begin(1);
    state = directoryReducer(state, { type: "settle", generation: 1, target: "clients", data: [clientDto] });
    state = directoryReducer(state, { type: "settle", generation: 1, target: "projects", data: [projectDto] });
    state = directoryReducer(state, { type: "fail", generation: 1, target: "clients", kind: "unauthorized" });

    expect(state.unauthorized).toBe(true);
    expect(state.clients.data).toBeNull();
    expect(state.projects.data).toBeNull();

    const late = directoryReducer(state, { type: "settle", generation: 1, target: "projects", data: [projectDto] });
    expect(late.projects.data).toBeNull();
    expect(late.unauthorized).toBe(true);
  });

  it("reports an empty read as empty, not as a failure", () => {
    let state = begin(1);
    state = directoryReducer(state, { type: "settle", generation: 1, target: "clients", data: [] });
    expect(state.clients.state).toBe("empty");
    expect(state.clients.error).toBeNull();
    expect(state.clients.data).toEqual([]);
  });
});
