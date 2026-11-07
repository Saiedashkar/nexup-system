import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SALES_COPY, salesCopy } from "@/components/command/sales/copy";
import {
  DELIVERY_LINKS,
  JOURNEY_ORDER,
  STEP_OWNER,
  advance,
  advanceManually,
  assignOwner,
  canAdvance,
  completedCount,
  currentStep,
  editOffer,
  initialJourney,
  isValidFollowUp,
  planDelivery,
  recordAcceptance,
  reviewOffer,
  stepForOwner,
  stepForStation,
  stationForStep,
} from "@/components/command/sales/journey";
import { workspaceHref } from "@/components/command/state/department-workspace";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const DRAFT = "Storefront request — scope, price band, timeline.";

describe("sales demo journey", () => {
  it("starts at qualification with the scout holding it", () => {
    const state = initialJourney(DRAFT);
    expect(currentStep(state)).toBe("qualify");
    expect(state.owner).toBe("opportunity-scout");
    expect(completedCount(state)).toBe(0);
    expect(canAdvance(state)).toBe(true);
  });

  it("closes five steps in one order and ends after the fifth", () => {
    let state = initialJourney(DRAFT);
    state = advance(state); // qualify
    expect(currentStep(state)).toBe("assign");
    expect(state.owner).toBe("sales-manager");

    state = assignOwner(state, "follow-up-agent", "2026-11-10");
    state = advance(state);
    expect(currentStep(state)).toBe("offer");
    expect(state.owner).toBe("offer-manager");

    state = reviewOffer(state);
    state = advance(state);
    expect(currentStep(state)).toBe("accept");

    state = recordAcceptance(state);
    state = advance(state);
    expect(currentStep(state)).toBe("deliver");

    state = planDelivery(state, { choice: "existing", clientName: "Rebound", projectName: "Storefront v1" });
    state = advance(state);
    expect(currentStep(state)).toBe("done");
    expect(completedCount(state)).toBe(JOURNEY_ORDER.length);
    expect(advance(state)).toBe(state);
  });

  it("refuses to close a step whose gate is not met", () => {
    const atAssign = advance(initialJourney(DRAFT));
    expect(canAdvance(atAssign)).toBe(false);
    expect(advance(atAssign)).toBe(atAssign);

    expect(isValidFollowUp("")).toBe(false);
    expect(isValidFollowUp("10-11-2026")).toBe(false);
    expect(isValidFollowUp("2026-02-31")).toBe(false);
    expect(isValidFollowUp("2026-11-10")).toBe(true);

    const withDate = assignOwner(atAssign, "sales-manager", "2026-11-10");
    expect(canAdvance(withDate)).toBe(true);
  });

  it("requires an edited, reviewed draft before the offer closes", () => {
    let state = advance(assignOwner(advance(initialJourney(DRAFT)), "sales-manager", "2026-11-10"));
    expect(currentStep(state)).toBe("offer");

    /* The seeded draft is reviewable; the gate is the review, not the text. */
    expect(canAdvance(state)).toBe(false);
    state = reviewOffer(state);
    expect(canAdvance(state)).toBe(true);

    /* Editing after a review invalidates it: the reviewed words are gone. */
    state = editOffer(state, "Different price band entirely.");
    expect(state.offerReviewed).toBe(false);
    expect(canAdvance(state)).toBe(false);

    expect(reviewOffer({ ...state, offer: "short" }).offerReviewed).toBe(false);
  });

  it("completes manually without pretending the gate was met", () => {
    const state = advanceManually(initialJourney(DRAFT));
    expect(currentStep(state)).toBe("assign");
    expect(state.followUpAt).toBe("");
    expect(state.offerReviewed).toBe(false);
  });

  it("keeps a role, a station and a step pointing at each other", () => {
    for (const step of JOURNEY_ORDER) {
      const station = stationForStep(step);
      const owner = STEP_OWNER[step];
      expect(stationForStep(stepForStation(station))).toBe(station);
      expect(stepForOwner(owner)).toBeDefined();
    }
    expect(stepForOwner("offer-manager")).toBe("offer");
    expect(stepForOwner("sales-manager")).toBe("assign");
  });
});

describe("sales copy", () => {
  const keys = (value: unknown, prefix = ""): string[] => {
    if (value === null || typeof value !== "object") return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keys(child, prefix ? `${prefix}.${key}` : key),
    );
  };

  it("has the same every key in both languages", () => {
    expect(keys(SALES_COPY.en).sort()).toEqual(keys(SALES_COPY.ar).sort());
  });

  it("has no empty sentence", () => {
    for (const locale of ["en", "ar"] as const) {
      const dictionary = SALES_COPY[locale];
      for (const key of keys(dictionary)) {
        const leaf = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dictionary);
        expect(typeof leaf, `${locale}:${key}`).toBe("string");
        expect((leaf as string).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to English for an unknown locale", () => {
    expect(salesCopy("ar").room.title).toBe(SALES_COPY.ar.room.title);
    expect(salesCopy("fr").room.title).toBe(SALES_COPY.en.room.title);
  });
});

describe("the two rooms are linked and nothing is broken", () => {
  it("opens the gateway from the Marketing & Sales plate", () => {
    expect(workspaceHref("growth")).toBe("/command/sales");
    expect(workspaceHref("finance")).toBe("/command/departments/finance-control");
  });

  it("has a real route for every link the two surfaces print", () => {
    const routes = [
      "/command/sales",
      "/command/sales/room",
      "/command/marketing",
      DELIVERY_LINKS.clients,
      DELIVERY_LINKS.projects,
    ];
    for (const route of routes) {
      const file = route === "/command/sales" ? "src/app/command/sales/page.tsx" : `${`src/app/command${route.replace("/command", "")}`}/page.tsx`;
      expect(existsSync(path.join(ROOT, file)), `${route} → ${file}`).toBe(true);
    }
  });

  it("opens the marketing room from the second door now that it has been delivered", () => {
    const gateway = read("src/components/command/sales/sales-gateway.tsx");
    /* The door carries a real href and the room's route exists on disk. Before
       the delivery this assertion was the opposite: no `<Link`, no `href`, and a
       `pending` word instead — because a link to a page that has not landed is a
       404 wearing a badge. */
    expect(gateway).toContain('href="/command/marketing"');
    expect(gateway).not.toContain("copy.gateway.marketing.pending");
    expect(gateway).not.toContain("data-state=\"waiting\"");
    expect(existsSync(path.join(ROOT, "src/app/command/marketing/page.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "src/components/command/marketing/marketing-room.tsx"))).toBe(true);
  });
});

describe("the demo writes nothing", () => {
  const sources = [
    "src/components/command/sales/sales-room.tsx",
    "src/components/command/sales/sales-gateway.tsx",
    "src/components/command/sales/journey.ts",
  ];

  it("contains no network, database or provider call", () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, file).not.toMatch(/\bfetch\s*\(/);
      expect(text, file).not.toMatch(/from\s+["'`][^"'`]*prisma[^"'`]*["'`]/i);
      expect(text, file).not.toMatch(/from\s+["'`][^"'`]*\/api\/[^"'`]*["'`]/);
    }
  });

  it("has no route handler beside the two pages", () => {
    for (const route of ["src/app/command/sales", "src/app/command/sales/room"]) {
      expect(existsSync(path.join(ROOT, route, "route.ts"))).toBe(false);
      expect(existsSync(path.join(ROOT, route, "actions.ts"))).toBe(false);
    }
  });
});
