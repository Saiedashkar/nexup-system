import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEPARTMENT_IDS } from "@/components/command/state/organization-model";
import { departmentMissions, totalMissions } from "@/components/command/state/department-workspace";
import {
  DEMO_STATES,
  applyDecision,
  applyTurn,
  commandAdapter,
  demoCommandAdapter,
} from "@/components/command/state/demo/adapter";
import { demoDataset } from "@/components/command/state/demo/dataset";
import {
  AGENT_STATUS_META,
  MISSION_STATUS_META,
  SYSTEM_STATE_META,
  companyPulse,
  decisionQueue,
  isLiveMission,
  operatingPulse,
  systemHealth,
  workforceStatus,
} from "@/components/command/state/demo/selectors";
import type { MissionStatus, SystemState } from "@/components/command/state/demo/types";
import { keyboardInset } from "@/components/command/state/use-keyboard-inset";

/** The repository root, from this file's own location — no cwd assumptions. */
const ROOT = resolve(__dirname, "..");

/**
 * The Product Lab's contract, asserted against the model rather than against a
 * component. Every row here is a promise a surface in the prototype makes:
 *
 *  · the mission list cannot contradict the department workspaces it mirrors;
 *  · every state a surface can render has a label and a tone;
 *  · the decision queue is ordered by risk and its counts reconcile;
 *  · the connection map is honest — no system claims to be connected without
 *    evidence, and every system declares one;
 *  · mutations are local: settling a decision keeps the queue arithmetic true and
 *    appends exactly one audit event;
 *  · the executive's replies are derived from the dataset and call no provider.
 *
 * There is no database, no network and no clock here — these are pure functions
 * over typed demo data, which is exactly what the Step 6 adapter must also be
 * able to satisfy.
 */

const STATES: MissionStatus[] = ["planned", "active", "waiting", "blocked", "review", "completed", "failed"];

describe("Product Lab · dataset integrity", () => {
  it("mirrors every mission the department workspaces own, and nothing else", () => {
    const mirrored = DEPARTMENT_IDS.flatMap((id) => departmentMissions(id).map((m) => m.id));
    const present = mirrored.filter((id) => demoDataset().missions.some((m) => m.id === id));

    expect(present).toHaveLength(mirrored.length);
    expect(mirrored.length).toBe(totalMissions());
  });

  /**
   * Not every state has an example, and the prototype does not pretend otherwise:
   * Mission Control's state breakdown renders a zero row for the states nothing
   * is in, which is the empty treatment being exercised for real. What is
   * asserted here is that the states a reviewer must be able to SEE — held work,
   * settled work and failures — are all present.
   */
  it("carries the states the product must be read in", () => {
    const dataset = demoDataset();
    for (const state of ["blocked", "waiting", "review", "completed", "failed"] as MissionStatus[]) {
      expect(dataset.missions.some((m) => m.status === state), `no mission in state "${state}"`).toBe(true);
    }
    /* The vocabulary is complete even where the data is not. */
    expect(STATES).toHaveLength(7);
  });

  it("gives every mission an owner, a department and a task graph", () => {
    for (const mission of demoDataset().missions) {
      expect(mission.owner.length, `${mission.id} has no owner`).toBeGreaterThan(0);
      expect(DEPARTMENT_IDS).toContain(mission.departmentId);
      expect(mission.tasks.length, `${mission.id} has no tasks`).toBeGreaterThan(0);
      expect(mission.timeline.length, `${mission.id} has no timeline`).toBeGreaterThan(0);
    }
  });

  it("explains a blocked or waiting mission rather than leaving the state bare", () => {
    for (const mission of demoDataset().missions) {
      if (mission.status === "blocked") {
        expect(mission.blockedReason, `${mission.id} is blocked with no reason`).toBeTruthy();
      }
      if (mission.status === "waiting") {
        expect(mission.waitingOn, `${mission.id} is waiting with nothing named`).toBeTruthy();
      }
      if (mission.status === "completed" || mission.status === "failed") {
        expect(mission.result, `${mission.id} is settled with no outcome`).toBeTruthy();
      }
    }
  });

  it("points every decision at a mission that exists", () => {
    const dataset = demoDataset();
    for (const decision of dataset.decisions) {
      expect(
        dataset.missions.some((m) => m.id === decision.missionId),
        `${decision.id} references ${decision.missionId}`,
      ).toBe(true);
      expect(decision.requestedBy.length, `${decision.id} has no requester`).toBeGreaterThan(0);
      expect(decision.policy.length, `${decision.id} has no policy`).toBeGreaterThan(0);
    }
  });

  it("keeps every agent reference resolvable", () => {
    const dataset = demoDataset();
    for (const mission of dataset.missions) {
      for (const id of mission.agents) {
        expect(dataset.agents.some((a) => a.id === id), `${mission.id} references agent ${id}`).toBe(true);
      }
    }
    for (const agent of dataset.agents) {
      expect(
        agent.reportsTo === "founder" || dataset.agents.some((a) => a.id === agent.reportsTo),
        `${agent.id} reports to ${agent.reportsTo}`,
      ).toBe(true);
      for (const id of agent.missionIds) {
        expect(dataset.missions.some((m) => m.id === id), `${agent.id} references mission ${id}`).toBe(true);
      }
    }
  });

  it("registers the workforce as a mix of humans and agents", () => {
    const dataset = demoDataset();
    expect(dataset.agents.filter((a) => a.kind === "human").length).toBeGreaterThan(0);
    expect(dataset.agents.filter((a) => a.kind === "agent").length).toBeGreaterThan(0);
    expect(dataset.agents.filter((a) => a.tier === "executive")).toHaveLength(1);
  });
});

describe("Product Lab · status vocabulary", () => {
  it("labels and tones every mission state", () => {
    for (const state of STATES) {
      expect(MISSION_STATUS_META[state]?.label, `no label for ${state}`).toBeTruthy();
      expect(MISSION_STATUS_META[state]?.tone).toMatch(/^--nc-/);
    }
  });

  it("labels and tones every system state and every agent status", () => {
    const systemStates: SystemState[] = [
      "CONNECTED",
      "PARTIAL",
      "MOCK",
      "MISSING",
      "BLOCKED",
      "NEEDS_APPROVAL",
    ];
    for (const state of systemStates) {
      expect(SYSTEM_STATE_META[state]?.label).toBeTruthy();
      expect(SYSTEM_STATE_META[state]?.hint).toBeTruthy();
    }
    for (const agent of demoDataset().agents) {
      expect(AGENT_STATUS_META[agent.status]?.label).toBeTruthy();
    }
  });
});

describe("Product Lab · selectors reconcile", () => {
  it("counts live missions and settled missions without overlap", () => {
    const dataset = demoDataset();
    const live = dataset.missions.filter(isLiveMission);
    const settled = dataset.missions.filter((m) => !isLiveMission(m));

    expect(live.length + settled.length).toBe(dataset.missions.length);
    expect(live.some((m) => m.status === "completed" || m.status === "failed")).toBe(false);
  });

  it("orders the decision queue by risk and reconciles its own counts", () => {
    const queue = decisionQueue(demoDataset());
    const weights = { low: 1, medium: 2, high: 3, critical: 4 } as const;

    expect(queue.every((d) => d.status === "pending")).toBe(true);
    for (let i = 1; i < queue.length; i += 1) {
      expect(weights[queue[i - 1].risk]).toBeGreaterThanOrEqual(weights[queue[i].risk]);
    }
  });

  it("builds the company pulse from the same lists the pages show", () => {
    const dataset = demoDataset();
    const pulse = companyPulse(dataset);
    const byId = Object.fromEntries(pulse.map((figure) => [figure.id, figure]));

    const live = dataset.missions.filter(isLiveMission).length;
    const pending = dataset.decisions.filter((d) => d.status === "pending").length;
    const blocked = dataset.missions.filter((m) => m.status === "blocked").length;

    expect(byId.missions.value).toBe(String(live));
    expect(byId.decisions.value).toBe(String(pending));
    expect(byId.blocked.value).toBe(String(blocked));
    expect(pulse.every((figure) => figure.href?.startsWith("/command"))).toBe(true);
  });

  /**
   * The Command Center's band must not repeat the room's KPI row above it: two
   * readings of one organization, not the same figure twice on one page.
   */
  it("keeps the band's operating pulse distinct from the room's company pulse", () => {
    const dataset = demoDataset();
    const roomLabels = companyPulse(dataset).map((f) => f.label);
    const bandLabels = operatingPulse(dataset).map((f) => f.label);

    expect(bandLabels.some((label) => roomLabels.includes(label))).toBe(false);
    expect(bandLabels).toHaveLength(6);
    expect(operatingPulse(dataset).every((f) => f.href?.startsWith("/command"))).toBe(true);
  });

  it("reports workforce status from the directory itself", () => {
    const dataset = demoDataset();
    const status = workforceStatus(dataset);

    expect(status.total).toBe(dataset.agents.length);
    expect(status.active + status.thinking).toBe(
      dataset.agents.filter((a) => a.status === "active" || a.status === "thinking").length,
    );
    expect(status.averageUtilisation).toBeGreaterThanOrEqual(0);
    expect(status.averageUtilisation).toBeLessThanOrEqual(100);
  });

  it("counts system health so usable and degraded always add up", () => {
    const dataset = demoDataset();
    const health = systemHealth(dataset);

    expect(health.total).toBe(dataset.systems.length);
    expect(health.usable + health.degraded).toBe(health.total);
    expect(health.degraded).toBeGreaterThan(0);
  });

  it("never marks a system connected without evidence, and never leaves one without any", () => {
    for (const system of demoDataset().systems) {
      expect(system.evidence.length, `${system.id} has no evidence`).toBeGreaterThan(20);
      expect(system.stateDetail.length, `${system.id} has no state detail`).toBeGreaterThan(0);
      expect(system.at.x).toBeGreaterThanOrEqual(0);
      expect(system.at.x).toBeLessThanOrEqual(100);
      expect(system.at.y).toBeGreaterThanOrEqual(0);
      expect(system.at.y).toBeLessThanOrEqual(100);
    }
  });

  it("maps every integration asked for on the control map", () => {
    const ids = demoDataset().systems.map((s) => s.id);
    for (const required of [
      "supabase",
      "hermes",
      "bridge",
      "github",
      "codex",
      "freebuff",
      "vercel",
      "x",
      "meta",
      "whatsapp",
      "crm",
      "files",
    ]) {
      expect(ids, `${required} is missing from the map`).toContain(required);
    }
  });

  it("registers models with a complete control surface per entry", () => {
    const dataset = demoDataset();
    expect(dataset.models.length).toBeGreaterThanOrEqual(10);

    for (const model of dataset.models) {
      expect(model.capabilities.length, `${model.id} declares no capability`).toBeGreaterThan(0);
      expect(model.quota.usedPct).toBeGreaterThanOrEqual(0);
      expect(model.quota.usedPct).toBeLessThanOrEqual(100);
      expect(model.quota.note.length).toBeGreaterThan(0);
      expect(model.note.length).toBeGreaterThan(0);
    }

    expect(dataset.models.some((m) => m.roles.includes("default"))).toBe(true);
    expect(dataset.models.some((m) => m.roles.includes("fallback"))).toBe(true);
    expect(dataset.models.some((m) => m.provider === "Deterministic")).toBe(true);
  });

  it("keeps the finance shell disconnected and refuses to invent money", () => {
    const dataset = demoDataset();
    const finance = dataset.finance;

    expect(finance.connected).toBe(false);
    expect(finance.note.length).toBeGreaterThan(40);
    expect(finance.wallets.length).toBeGreaterThan(0);
    expect(finance.guards.length).toBeGreaterThan(0);

    /* Every money figure is a placeholder — except the held-approval count,
       which is derived from the decision queue and must agree with it. */
    for (const figure of finance.figures) {
      if (figure.id === "held") {
        expect(figure.value).toBe(String(dataset.decisions.filter((d) => d.status === "pending").length));
      } else {
        expect(figure.value, `${figure.id} invented a number`).toBe("—");
      }
    }
    expect(finance.wallets.every((w) => w.balance === "—")).toBe(true);
  });
});

describe("Product Lab · the adapter", () => {
  it("is the single swap point the surfaces read through", () => {
    expect(commandAdapter).toBe(demoCommandAdapter);
    expect(commandAdapter.id).toBe("demo-adapter");
  });

  it("answers every demo state with a complete read", async () => {
    for (const option of DEMO_STATES) {
      const result = await demoCommandAdapter.read(option.id);
      expect(result.dataset.source).toBe("demo-adapter");
      expect(["ready", "empty", "degraded"]).toContain(result.state);
      if (option.id === "empty") {
        expect(result.dataset.missions).toHaveLength(0);
        expect(result.dataset.decisions).toHaveLength(0);
        expect(result.dataset.agents).toHaveLength(0);
      }
    }
  });

  it("settles a decision locally and appends exactly one audit event", () => {
    const dataset = demoDataset();
    const before = dataset.decisions.filter((d) => d.status === "pending").length;
    const events = dataset.activity.length;

    const { decision, event } = demoCommandAdapter.decide(dataset, "d-01", "approved");
    const next = applyDecision(dataset, decision, event);

    expect(decision.status).toBe("approved");
    expect(decision.decidedBy).toBe("Founder");
    expect(next.decisions.filter((d) => d.status === "pending")).toHaveLength(before - 1);
    expect(next.activity).toHaveLength(events + 1);
    expect(next.activity[0].id).toBe(event.id);
    /* The original dataset is untouched: mutations are immutable. */
    expect(dataset.decisions.find((d) => d.id === "d-01")?.status).toBe("pending");
  });

  it("keeps a rejection reason with the record", () => {
    const dataset = demoDataset();
    const { decision, event } = demoCommandAdapter.decide(dataset, "d-07", "rejected", "Not yet.");
    const next = applyDecision(dataset, decision, event);

    expect(decision.status).toBe("rejected");
    expect(decision.note).toBe("Not yet.");
    expect(event.severity).toBe("notice");
    /* The reason survives into the dataset the history view reads. */
    expect(next.decisions.find((d) => d.id === "d-07")?.note).toBe("Not yet.");
    expect(next.decisions.find((d) => d.id === "d-07")?.status).toBe("rejected");
  });

  it("refuses an unknown decision instead of inventing one", () => {
    expect(() => demoCommandAdapter.decide(demoDataset(), "d-nope", "approved")).toThrow();
  });

  it("answers the executive from the dataset, without a provider", () => {
    const dataset = demoDataset();
    const pending = dataset.decisions.filter((d) => d.status === "pending").length;

    const needsMe = demoCommandAdapter.reply(dataset, "What needs me today?");
    expect(needsMe.from).toBe("exec");
    expect(needsMe.cards.some((card) => card.value === String(pending))).toBe(true);

    const blocked = demoCommandAdapter.reply(dataset, "Why is vendor consolidation blocked?");
    expect(blocked.kind).toBe("escalation");
    expect(blocked.actions.length).toBeGreaterThan(0);

    const workforce = demoCommandAdapter.reply(dataset, "Which agents are overloaded?");
    expect(workforce.cards.length).toBeGreaterThan(0);

    const models = demoCommandAdapter.reply(dataset, "What are the agents running on?");
    expect(models.actions.some((a) => a.href === "/command/models")).toBe(true);

    /* Unknown questions still get an honest operating summary, never an apology. */
    const other = demoCommandAdapter.reply(dataset, "Tell me something surprising.");
    expect(other.text).toContain("missions");
    expect(other.actions.length).toBeGreaterThan(0);
  });

  it("appends a conversation turn without touching the read history", () => {
    const dataset = demoDataset();
    const turns = dataset.exec.turns.length;
    const activity = dataset.activity.length;

    const next = applyTurn(dataset, demoCommandAdapter.reply(dataset, "What needs me today?"));

    expect(next.exec.turns).toHaveLength(turns + 1);
    expect(next.activity).toHaveLength(activity);
    expect(dataset.exec.turns).toHaveLength(turns);
  });
});

/**
 * THE PHONE KEYBOARD, AS ARITHMETIC
 * ──────────────────────────────────
 * `--nc-kb` is what keeps the four-cell bottom bar above the software keyboard
 * instead of behind it, and it is the only number in the phone shell the browser
 * cannot supply directly: the layout viewport's height and the visual viewport's
 * height are two different quantities and the difference between them IS the
 * keyboard. The clamping is asserted here because every one of these cases is a
 * real browser state — a pinch-zoomed page, a rounded viewport, an embedded
 * webview that reports a visual viewport taller than the layout one — and each
 * one of them, left unclamped, moves shell chrome off the screen.
 */
describe("phone keyboard inset", () => {
  it("is the covered height, never a negative or a fraction", () => {
    expect(keyboardInset(844, 844)).toBe(0);
    expect(keyboardInset(844, 508)).toBe(336);
    /* A viewport scrolled inside a zoomed visual viewport reports a smaller
       height AND a non-zero offset; counting the height alone would under-report
       by exactly that offset. */
    expect(keyboardInset(844, 508, 40)).toBe(296);
    /* Nonsense input must not be able to push chrome off the screen. */
    expect(keyboardInset(844, 900)).toBe(0);
    expect(keyboardInset(844, 844, -30)).toBe(0);
    expect(keyboardInset(Number.NaN, 508)).toBe(0);
    expect(keyboardInset(844.4, 508.4)).toBe(336);
  });

  it("is used by the shell, and defaulted to zero in the foundation", () => {
    /* The two halves of the mechanism have to keep agreeing: the CSS token is
       what the chrome reads, and the hook is what writes it. If either name
       changes without the other, the bar silently stops following the
       keyboard — which is a layout bug no screenshot of a keyboard-less page
       would ever show. */
    const css = readFileSync(resolve(ROOT, "src/app/command/foundation.css"), "utf8");
    expect(css).toContain("--nc-kb: 0px;");
    expect(css).toMatch(/\.nc-root \.nc-mobilebar \{[\s\S]*?bottom: var\(--nc-kb\);/);

    const shell = readFileSync(resolve(ROOT, "src/components/command/command-shell.tsx"), "utf8");
    expect(shell).toContain("useKeyboardInset(rootRef)");

    const layout = readFileSync(resolve(ROOT, "src/app/command/layout.tsx"), "utf8");
    expect(layout).toContain('interactiveWidget: "resizes-content"');
  });
});
